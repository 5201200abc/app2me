import { createV4InputLedger } from "./v4-bridge-input-ledger.js";
import { createV4RowActions } from "./v4-bridge-row-actions.js";
import { createV4SessionLifecycle } from "./v4-bridge-session-lifecycle.js";
import { createV4SessionQueries } from "./v4-bridge-session-queries.js";
import { createV4ColdHydration } from "./v4-bridge-cold-hydration.js";
import { createV4ArtifactQueries } from "./v4-bridge-artifact-queries.js";
import { createV4QueueAutoDrain } from "./v4-bridge-auto-drain.js";
import { createStoredSessionSummariesLoader } from "./v4-bridge-stored-summaries.js";

import { parseRemoteWorkspaceIdentity } from "@mycode/shared";
import { createExternalTurnFaultError } from "@mycode/core";
import { V4_NOTIFICATIONS } from "@mycode/shared/mycode-protocol-v4";
import { V4CommandExecutor } from "../mycode-protocol-v4/commands/executor.js";

import { lookupGlobalCreateSessionCommand } from "../mycode-protocol-v4/create-session-command-fact.js";
import type { V4CommandCoreHost } from "../mycode-protocol-v4/commands/types.js";
import { PersistentCommandIndex } from "../mycode-protocol-v4/persistent-command-index.js";

import { loadPersistentCommandFacts } from "../mycode-protocol-v4/persistent-command-facts.js";
import {
  ConversationV4Gateway,
  V4CommandNotImplementedError,
} from "../mycode-protocol-v4/v4-gateway.js";

import type { SessionId } from "@mycode/contracts";

import type { MyCodeProtocolAgentServerContext } from "./server-types.js";
import { createProtocolLogger } from "./server-types.js";
import { isConversationInputAdmissionCommand } from "./v4-bridge-resolve-input-command-for-admission.js";

export function createConversationV4Gateway(
  context: MyCodeProtocolAgentServerContext,
): ConversationV4Gateway {
  const log = createProtocolLogger(context.deps)?.child({
    module: "bootstrap.mycode_protocol_v4_gateway",
  });
  const persistentCommands = new PersistentCommandIndex({
    loadSession: async (sessionId) => {
      const live = context.sessions.get(sessionId);
      const stored = await context.deps.sessionStore?.getSession(sessionId as SessionId);
      if (!live && !stored) return null;
      const workspacePath = live?.workspace.workspacePath ?? stored?.directory;
      if (!workspacePath) return null;
      const workspaceIdentity = live?.workspace.workspaceIdentity ?? stored?.workspaceID;
      const facts = context.deps.sessionStore
        ? await loadPersistentCommandFacts(context.deps.sessionStore, sessionId as SessionId, {
            discardAdmittedOnLoad: !live,
          })
        : undefined;
      return {
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity: String(workspaceIdentity) } : {}),
        ...(facts ? { facts } : {}),
      };
    },
  });
  let nativeExecutor: V4CommandExecutor;
  const autoDrainV4QueueIfReady = createV4QueueAutoDrain(context, () => nativeExecutor);
  const coreHost: V4CommandCoreHost = {
    // 同一注册表对象引用：view 是旧 record 的结构化窄视图，字段变更双向可见。
    getRecord: (sessionId) => context.sessions.get(sessionId),
    // 同一登记表实例：broker（旧目录）注册反向请求 deferred，
    // v4 resolveInteraction handler 经此投递应答（v4 原生基础设施，非过渡钩子）。
    interactions: context.v4Interactions,
    logger: {
      info: (message, fields) => context.logger?.info(message, fields),
      warn: (message, fields) => context.logger?.warn(message, fields),
    },
    // v4 原生能力（非过渡钩子）：sendQueuedNow 必须读取 v4 投影里的完整 intent。
    // 命令执行时 context.v4Gateway 已由 server 注入（createConversationV4Gateway
    // 返回值回填），这里惰性取用避免构造期自引用。
    getQueueItem: (sessionId, queueItemId) =>
      context.v4Gateway?.getQueueItem(sessionId, queueItemId) ?? null,
    hasQueueItemKind: (sessionId, kind) =>
      context.v4Gateway?.hasQueueItemKind(sessionId, kind) ?? false,
    hasQueuedDelivery: (sessionId, delivery) =>
      context.v4Gateway?.hasQueuedDelivery(sessionId, delivery) ?? false,
    getQueueLength: (sessionId) => context.v4Gateway?.getQueueLength(sessionId) ?? 0,
    waitForProjectionEventCommit: (sessionId, eventId, options) => {
      const gateway = context.v4Gateway;
      if (!gateway) {
        return Promise.reject(new Error("v4 gateway unavailable for projection commit wait"));
      }
      return gateway.waitForProjectionEventCommit(sessionId, eventId, options);
    },
    ...createV4InputLedger(context, persistentCommands),
    // held choice 裁决（heldQueueInputRequiresChoice）：读投影 inputRouting.mode。
    getInputRoutingMode: (sessionId) => context.v4Gateway?.getInputRoutingMode(sessionId) ?? null,
    ...createV4RowActions(context),
    ...createV4SessionLifecycle(context, autoDrainV4QueueIfReady),
  };
  nativeExecutor = new V4CommandExecutor(coreHost);
  const loadStoredSessionSummaries = createStoredSessionSummariesLoader(context);
  return new ConversationV4Gateway({
    cliVersion: context.deps.version,
    sessionExists: (sessionId) => context.sessions.has(sessionId),
    onDebug: (message) => log?.debug(message),
    onTargetCompleted: (sessionId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return;
      // background task-notification 的 goal verifier 不经过 v4 prompt 的
      // finally/afterLegacyStateMutation；TargetChanged(complete) 虽已提交，future queue
      // 因而没有下一次 mutation 来重评。这里只 detached 触发既有 gate，不能阻塞投影。
      void Promise.resolve()
        .then(() => autoDrainV4QueueIfReady(record))
        .catch((error: unknown) => {
          context.logger?.warn("v4 auto-drain reevaluation after target completion failed", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
        });
    },
    ...createV4ColdHydration(context, log),
    emitWireFrame: (wire) =>
      context.notify({
        method: V4_NOTIFICATIONS.conversationFrame,
        params: wire,
      }),
    emitLocalTtftFacts: (facts) =>
      context.notify({ method: V4_NOTIFICATIONS.localTtftFacts, params: facts }),
    emitConversationTelemetryFact: (fact) =>
      context.notify({
        method: V4_NOTIFICATIONS.conversationTelemetryFact,
        params: fact,
      }),
    emitCuaPermissionObservation: (observation) =>
      context.notify({
        method: V4_NOTIFICATIONS.cuaPermissionObservation,
        params: observation,
      }),
    ...createV4SessionQueries(context),
    getStoredSessionSummaries: loadStoredSessionSummaries,
    refreshLegacySessionSummaries: (workspaceId, legacyTaskIds) =>
      parseRemoteWorkspaceIdentity(workspaceId)
        ? loadStoredSessionSummaries(workspaceId, legacyTaskIds)
        : null,
    // 回落面已清零（20 命令全部原生）：supports 未命中（未知命令类型）→
    // notImplemented → ACK failed fault.command.notImplemented。
    executeCommand: (envelope, admission) =>
      nativeExecutor.supports(envelope.type)
        ? nativeExecutor.execute(envelope, admission)
        : Promise.reject(new V4CommandNotImplementedError(envelope.type)),
    admitCommandInput: async (envelope, admission) => {
      // 仅隐藏 composer 不能阻止旧 child 标签页续聊。类型准入必须早于
      // ledger/输入历史写入；detached child 没有 record 时只查元数据，不激活第二个 runtime。
      if (
        envelope.sessionId &&
        (isConversationInputAdmissionCommand(envelope.type) ||
          envelope.type === "resumeGoal" ||
          envelope.type === "sendQueuedNow" ||
          envelope.type === "forkAssistant" ||
          envelope.type === "createSelectionSideSession")
      ) {
        const taskType =
          context.sessions.get(envelope.sessionId)?.taskType ??
          (await context.deps.sessionStore?.getSession(envelope.sessionId as SessionId))?.taskType;
        if (taskType === "subagent_child") {
          throw Object.assign(new Error("Subagent sessions are read-only"), {
            reasonCode: "guard.subagentReadOnly",
          });
        }
      }
      if (!isConversationInputAdmissionCommand(envelope.type)) return null;
      if (!envelope.sessionId) return null;
      return (await coreHost.admitInputCommand?.(envelope, envelope.sessionId, admission)) ?? null;
    },
    cancelCommandInput: async (envelope, queueItemId, reason) => {
      if (!envelope.sessionId) return;
      await coreHost.cancelInputCommand?.(envelope.sessionId, queueItemId, reason);
    },
    terminateTurnForProjectionFault: (sessionId, reasonCode) => {
      const record = context.sessions.get(sessionId);
      const controller = record?.activeAbortController;
      if (!controller || controller.signal.aborted) return;
      // 投影越过 16MiB 后继续生成只会让所有后续 snapshot 都无法编码。
      // gateway 先原子拒绝越界事件并登记 protocol fault，再单次调用这里中止模型 turn；
      // abort 的正常终态负责释放 active lock，不能在 gateway 里越层伪造 TurnError。
      controller.abort(createExternalTurnFaultError(reasonCode));
    },
    // commands/query 持久化 fallback：同 session 首次查询惰性建索引，后续四个来源
    // 共用该索引；anchor/marker/child/discarded 写入走 record 增量更新。
    lookupTranscriptCommand: (key) =>
      key.sessionId === null
        ? lookupGlobalCreateSessionCommand(context.deps.sessionStore, key.commandId)
        : persistentCommands.lookup("transcript", key),
    lookupTimelineCommand: (key) => persistentCommands.lookup("timeline", key),
    lookupChildCommand: (key) => persistentCommands.lookup("child", key),
    lookupDiscardedCommand: (key) => persistentCommands.lookup("discarded", key),
    invalidatePersistentCommandFacts: (sessionId) => persistentCommands.invalidate(sessionId),
    ...createV4ArtifactQueries(context),
    onError: (scope, error, errorContext) =>
      context.logger?.warn("MyCode Protocol v4 gateway error", {
        ...errorContext,
        error: error instanceof Error ? error.message : String(error),
        event: "mycode_protocol.v4.gateway_error",
        module: "bootstrap.mycode_protocol",
        scope,
      }),
  });
}
