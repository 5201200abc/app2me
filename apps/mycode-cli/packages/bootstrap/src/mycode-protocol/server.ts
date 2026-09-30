import { ProtocolClientRequests } from "./client-requests.js";
import { ProtocolOperationCancellation } from "./operation-cancellation.js";
import { dispatchProtocolRequest } from "./request-dispatch.js";

import type { BrowserControlPort } from "@mycode/contracts";
import { InMemoryWorkspaceHookPolicyProvider } from "@mycode/core";

import type {
  MyCodeProtocolError,
  MyCodeProtocolMessage,
  MyCodeProtocolRequest,
  MyCodeProtocolRequestId,
  MyCodeProtocolResponse,
} from "@mycode/shared";

import { ProtocolRuntimeResources } from "./runtime-resources.js";

import {
  V4InteractionRegistry,
  resolveV4InteractionRegistryOptionsFromEnv,
} from "../mycode-protocol-v4/interaction-registry.js";
import { createConversationV4Gateway } from "./v4-bridge.js";
import { createSessionResidentPoolHost } from "./session-residency.js";
import {
  DEFAULT_SESSION_RESIDENT_HIGH_WATER_COUNT,
  SessionResidentPool,
} from "./session-resident-pool.js";
import { createProtocolBrowserControlBroker } from "./browser-control-broker.js";
import {
  createProtocolLogger,
  isErrorResponse,
  isNotification,
  isRequest,
  isResponse,
  ProtocolRequestError,
  toProtocolError,
  type MyCodeProtocolAgentDependencies,
  type MyCodeProtocolAgentServerContext,
  type MyCodeProtocolSessionRecord,
} from "./server-types.js";
import { createInMemorySessionEventStore } from "@mycode/contracts";
import {
  type MyCodeProtocolOutboundMessage,
  type MyCodeProtocolPostResponseBatch,
  collectResidencySessionIds,
} from "./server-max-client-request-reannounce-interval-ms.js";

export type { MyCodeProtocolAgentDependencies, MyCodeProtocolSessionRecord };

export class MyCodeProtocolAgentServer {
  private readonly runtimeResources: ProtocolRuntimeResources;
  private shutdownPromise?: Promise<void>;
  readonly browserControlPort: BrowserControlPort;
  /**
   * 官方 MCP 身份头端口所需的最小上下文。
   * MCP 连接池的构造早于 server，需要在 server 就绪后回填闭包持有的引用——
   * 与 v4Gateway 同样的构造顺序收口方式。只暴露 requestClient，不外泄整个 context。
   */
  get officialMcpAuthRequestContext(): Pick<MyCodeProtocolAgentServerContext, "requestClient"> {
    return this.context;
  }
  private readonly context: MyCodeProtocolAgentServerContext;
  private readonly logger;
  /**
   * subscribe initial frame 按 JSON-RPC request id 隔离。connection 必须先 take，
   * 再写 response line，最后按数组顺序写 notification，不能靠 microtask 猜时序。
   */
  private readonly postResponseOutbox = new Map<
    MyCodeProtocolRequestId,
    MyCodeProtocolPostResponseBatch
  >();
  private readonly clientRequests = new ProtocolClientRequests();
  private readonly operations = new ProtocolOperationCancellation();
  disconnectClient(error: Error): void {
    this.clientRequests.disconnectClient(error);
  }

  constructor(deps: MyCodeProtocolAgentDependencies) {
    this.runtimeResources = new ProtocolRuntimeResources(deps.createMyCodeApp);
    const resolvedDeps = {
      ...deps,
      createMyCodeApp: this.runtimeResources.create,
      // 默认 turn 窗口保留策略。
      createSessionEventStore:
        deps.createSessionEventStore ?? (() => createInMemorySessionEventStore()),
      workspaceHookPolicyProvider:
        deps.workspaceHookPolicyProvider ?? new InMemoryWorkspaceHookPolicyProvider(),
    };
    this.logger = createProtocolLogger(resolvedDeps);
    this.context = {
      assertServing: () => this.runtimeResources.assertServing(),
      deps: resolvedDeps,
      logger: this.logger,
      appRuntimePreferences: {
        askUserQuestionAutoResolutionEnabled: true,
        modelIoFullRetentionEnabled: false,
        offPeakToolEnabled: false,
        // 动态工作流灰度门 fail-closed：Host 必须显式 workspace/updateDynamicWorkflowPolicy
        // 才开启。
        dynamicWorkflowEnabled: false,
      },
      notify: (notification) => this.clientRequests.notify(notification),
      requestClient: (method, params, resultSchema, options) =>
        this.clientRequests.requestClient(method, params, resultSchema, options),
      sessions: new Map<string, MyCodeProtocolSessionRecord>(),
      // 交互应答登记表（broker 反向请求 × v4 resolveInteraction 命令的汇合点）。
      v4Interactions: new V4InteractionRegistry(
        resolveV4InteractionRegistryOptionsFromEnv(deps.env ?? process.env),
      ),
    };
    // v4 通道：gateway 闭包持有 context 做帧出口与命令副作用，构造完立即挂回。
    this.context.v4Gateway = createConversationV4Gateway(this.context);
    this.browserControlPort = createProtocolBrowserControlBroker(this.context);
    const sessionResidentTargetCount =
      deps.sessionResidentPoolOptions?.targetCount ?? deps.sessionResidentTargetCount;
    const sessionResidentHighWaterCount =
      deps.sessionResidentPoolOptions?.highWaterCount ??
      (sessionResidentTargetCount === undefined
        ? undefined
        : Math.max(DEFAULT_SESSION_RESIDENT_HIGH_WATER_COUNT, sessionResidentTargetCount));
    // 单 CLI resident session 池：协议 request release 主动收敛，资源 sampler 只作兜底。
    this.context.sessionResidentPool = new SessionResidentPool(
      createSessionResidentPoolHost(this.context),
      {
        ...deps.sessionResidentPoolOptions,
        // legacy target 曾同时覆盖 high/low，导致迟滞窗口塌为 0；只覆盖 low。
        // 仅配置 target 且超过默认 high 时抬升隐式 high，显式非法组合仍由 pool 拒绝。
        highWaterCount: sessionResidentHighWaterCount,
        targetCount: sessionResidentTargetCount,
      },
    );
  }

  /** 低频 sampler 兜底入口；正常收敛由每个协议 request 的 operation lease 释放触发。 */
  rebalanceResidentSessions(): void {
    this.context.sessionResidentPool?.rebalance();
  }

  /**
   * 借同一 60s 节拍做 event store 的时间兜底淘汰：
   * subagent 子 session 只有一个 turn，等不到下一个 turn_started，只能按时间清。返回淘汰条数。
   */
  pruneSessionEventStores(nowMs: number = Date.now()): number {
    let evicted = 0;
    for (const record of this.context.sessions.values()) {
      evicted += record.eventStore.pruneTransientEvents?.(nowMs) ?? 0;
    }
    return evicted;
  }

  /** 同一 60s 节拍：释放已终态、无订阅者、无 record 的 detached subagent child publisher。 */
  pruneDetachedChildPublishers(nowMs: number = Date.now()): number {
    return this.context.v4Gateway?.pruneDetachedChildPublishers(nowMs) ?? 0;
  }

  /**
   * 内存诊断计数器，随 60s 资源采样写本地日志。
   * 只读 Map.size / 数组长度，不触碰 session 状态；持久化 event store 不提供 getStats 时计 0。
   */
  collectMemoryDiagnostics(): Record<string, number> {
    let eventRows = 0;
    let eventEvicted = 0;
    let eventTransientRetained = 0;
    for (const record of this.context.sessions.values()) {
      const stats = record.eventStore.getStats?.();
      eventRows += stats?.events ?? 0;
      eventEvicted += stats?.evictedEvents ?? 0;
      eventTransientRetained += stats?.retainedTransient ?? 0;
    }
    const counters: Record<string, number> = {
      sessions: this.context.sessions.size,
      eventRows,
      eventEvicted,
      eventTransientRetained,
    };
    const v4 = this.context.v4Gateway?.collectMemoryDiagnostics();
    if (v4) {
      for (const [key, value] of Object.entries(v4)) {
        counters[`v4.${key}`] = value;
      }
    }
    return counters;
  }

  setNotificationSink(sink: (message: MyCodeProtocolOutboundMessage) => void): void {
    this.runtimeResources.assertServing();
    this.clientRequests.setNotificationSink(sink);
  }

  /** 进程资源关闭，不使用会删除产品会话/发布 session.removed 的 session/close。 */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.runtimeResources.close();
    const error = new Error("MyCode Protocol runtime stopping");
    this.disconnectClient(error);
    this.clientRequests.clearNotificationSink();
    this.clearPostResponseMessages();
    this.operations.abortAll(error);

    for (const record of this.context.sessions.values()) {
      record.activeAbortController?.abort(error);
      try {
        record.unsubscribe?.();
      } catch {
        this.logger?.warn("Session unsubscribe failed during protocol shutdown", {
          event: "mycode_protocol.session.unsubscribe.failed",
        });
      }
    }
    return this.shutdownPromise;
  }

  /** app drain 有界结束后释放投影；即使某个 app.close 挂起也必须执行。 */
  disposeProjections(): void {
    this.context.v4Gateway?.dispose();
    this.context.sessions.clear();
  }

  /** 一次性取走某 request 的 post-response messages；重复 take 返回空数组。 */
  takePostResponseMessages(requestId: MyCodeProtocolRequestId): MyCodeProtocolOutboundMessage[] {
    const batch = this.takePostResponseBatch(requestId);
    batch?.commit();
    return [...(batch?.messages ?? [])];
  }

  /** production NDJSON 取完整 batch；只有全部 write 成功后才调 commit。 */
  takePostResponseBatch(
    requestId: MyCodeProtocolRequestId,
  ): MyCodeProtocolPostResponseBatch | null {
    const batch = this.postResponseOutbox.get(requestId) ?? null;
    this.postResponseOutbox.delete(requestId);
    return batch;
  }

  /** connection close / server dispose 时释放尚未写出的 initial frame 引用。 */
  clearPostResponseMessages(): void {
    this.postResponseOutbox.clear();
  }

  async handleMessage(
    message: MyCodeProtocolMessage,
  ): Promise<MyCodeProtocolError | MyCodeProtocolResponse | undefined> {
    this.runtimeResources.assertServing();
    if (isResponse(message)) {
      this.clientRequests.resolveClientRequest(message.id, message.result);
      return undefined;
    }
    if (isErrorResponse(message)) {
      this.clientRequests.rejectClientRequest(
        message.id,
        new ProtocolRequestError(message.error.code, message.error.message, message.error.data),
      );
      return undefined;
    }
    if (isRequest(message)) {
      return await this.handleRequest(message);
    }
    if (isNotification(message)) {
      this.logger?.debug("MyCode Protocol notification ignored", {
        event: "mycode_protocol.notification.ignored",
        method: message.method,
        module: "bootstrap.mycode_protocol",
      });
    }
    return undefined;
  }

  private async handleRequest(
    request: MyCodeProtocolRequest,
  ): Promise<MyCodeProtocolError | MyCodeProtocolResponse> {
    // request id 可在前一请求完成后复用；新请求不能继承未消费的旧 outbox。
    this.postResponseOutbox.delete(request.id);
    let releaseResidencyOperation: (() => void) | undefined;
    try {
      // subscribe hydration、workspace 配置与 resume 都可能跨 await。若只看
      // session 当前状态，sampler 会在 handler 持有旧 record 时把它关闭。进程级 lease
      // 覆盖整个 request；能识别的 sessionIds 额外用于冷恢复闸门与 LRU touch。
      releaseResidencyOperation = await this.context.sessionResidentPool?.acquireOperation(
        collectResidencySessionIds(request.params),
      );
      const result = await dispatchProtocolRequest(
        {
          context: this.context,
          postResponseOutbox: this.postResponseOutbox,
          operations: this.operations,
        },
        request,
      );
      return this.ok(request.id, result);
    } catch (error) {
      this.postResponseOutbox.delete(request.id);
      const protocolError = toProtocolError(error);
      return this.fail(request.id, protocolError.code, protocolError.message, protocolError.data);
    } finally {
      releaseResidencyOperation?.();
    }
  }

  private ok(id: MyCodeProtocolRequestId, result: unknown): MyCodeProtocolResponse {
    return { id, result };
  }

  private fail(
    id: MyCodeProtocolRequestId,
    code: number,
    message: string,
    data?: unknown,
  ): MyCodeProtocolError {
    return { error: { code, data, message }, id };
  }
}
