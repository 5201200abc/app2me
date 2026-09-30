import { LocalTtftRecorder } from "./local-ttft.js";
import { localTtftNow, localTtftFactsSchema } from "@mycode/shared/mycode-protocol-v4";

import type { ConversationRowTarget } from "@mycode/shared/mycode-protocol-v4";
import { PROTOCOL_V4_LIMITS } from "@mycode/shared/mycode-protocol-v4";
import { AttachmentUploadRegistry } from "./attachment-upload-registry.js";
import { ColdSessionResumeCoordinator } from "./cold-session-resume.js";
import { CommandInbox } from "./command-inbox.js";
import { ConversationTopicPublisher } from "./conversation-topic-publisher.js";

import { SessionsIndexFanoutThrottle } from "./sessions-index-fanout-throttle.js";

import { SessionsIndexPublisherRegistry } from "./sessions-index-publisher-registry.js";
import { WorkspaceConfigPublisher } from "./workspace-config-publisher.js";

import { ConversationTelemetryFactNormalizer } from "./conversation-telemetry-facts.js";
import { CuaPermissionObservationNormalizer } from "./cua-permission-observation.js";

import {
  type HydrationBuffer,
  type RawSequenceState,
  type ProjectionEventCommitWaiter,
  type FlushState,
  type BinaryReadCacheEntry,
  type V4GatewayHost,
  type ConversationV4GatewayOptions,
  rowTargetActionForCommand,
} from "./v4-gateway-v4-gateway-host.js";
import { defaultLogEpoch } from "./v4-gateway-v4-command-not-implemented-error.js";
import { gatewayConnection, type GatewayConnectionMethods } from "./v4-gateway-connection.js";
import { gatewayIngest, type GatewayIngestMethods } from "./v4-gateway-ingest.js";
import {
  gatewayCommitWaiters,
  type GatewayCommitWaitersMethods,
} from "./v4-gateway-commit-waiters.js";
import {
  gatewayDetachedChildren,
  type GatewayDetachedChildrenMethods,
} from "./v4-gateway-detached-children.js";
import {
  gatewaySessionIndex,
  type GatewaySessionIndexMethods,
} from "./v4-gateway-session-index.js";
import {
  gatewayWorkspaceConfig,
  type GatewayWorkspaceConfigMethods,
} from "./v4-gateway-workspace-config.js";
import {
  gatewaySubscriptions,
  type GatewaySubscriptionsMethods,
} from "./v4-gateway-subscriptions.js";
import {
  gatewayWorkflowQueries,
  type GatewayWorkflowQueriesMethods,
} from "./v4-gateway-workflow-queries.js";
import {
  gatewayConversationQueries,
  type GatewayConversationQueriesMethods,
} from "./v4-gateway-conversation-queries.js";
import {
  gatewayAttachmentUpload,
  type GatewayAttachmentUploadMethods,
} from "./v4-gateway-attachment-upload.js";
import {
  gatewayMediaQueries,
  type GatewayMediaQueriesMethods,
} from "./v4-gateway-media-queries.js";
import { gatewayMediaCache, type GatewayMediaCacheMethods } from "./v4-gateway-media-cache.js";
import { gatewayCommands, type GatewayCommandsMethods } from "./v4-gateway-commands.js";
import {
  gatewayProjectionQueries,
  type GatewayProjectionQueriesMethods,
} from "./v4-gateway-projection-queries.js";
import { gatewayLifecycle, type GatewayLifecycleMethods } from "./v4-gateway-lifecycle.js";
import {
  gatewayPublisherReadiness,
  type GatewayPublisherReadinessMethods,
} from "./v4-gateway-publisher-readiness.js";
import { gatewayHydration, type GatewayHydrationMethods } from "./v4-gateway-hydration.js";
import { gatewayRawSequence, type GatewayRawSequenceMethods } from "./v4-gateway-raw-sequence.js";
/** 网关唯一状态所有者；公开入口不暴露内部状态。 */
export class V4GatewayEngine {
  readonly publishers = new Map<string, ConversationTopicPublisher>();
  /** sessions-index：workspaceId → 列表 publisher（与 conversation 并列，独立 seq/logEpoch）。 */
  readonly indexPublishers = new SessionsIndexPublisherRegistry();
  /** workspace-config：workspaceId → 配置目录 publisher（conflated 整体替换态）。 */
  readonly configPublishers = new Map<string, WorkspaceConfigPublisher>();
  /** 已完成首次 hydration 的 session（避免重复重建 / 双计，见 hydratePublisher）。 */
  readonly hydratedSessions = new Set<string>();
  /** 首次 hydration 按 session 单飞；并发 pane 共享同一份重建结果。 */
  readonly hydrationInFlight = new Map<string, Promise<ConversationTopicPublisher>>();
  /** cold activation 到 hydration 的 READY 水位；只阻塞本次恢复期间的 command/query。 */
  readonly readyFlights = new Map<string, Promise<ConversationTopicPublisher>>();
  /** load await 窗口内的 raw accepted events；重建后按 cursor/eventId 补回。 */
  readonly hydrationBuffers = new Map<string, HydrationBuffer>();
  /** transcript 合成序列与 runtime raw 序列之间的 per-session 单调映射。 */
  readonly rawSequenceStates = new Map<string, RawSequenceState>();
  /** connection-independent；command admission 与 transport subscription 生命周期解耦。 */
  readonly projectionEventCommitWaiters = new Map<
    string,
    Map<string, Set<ProjectionEventCommitWaiter>>
  >();
  /** 没有独立 bootstrap record、但由父 runtime 持续转发 raw events 的 live child。 */
  readonly detachedLiveSessions = new Set<string>();
  /**
   * detached subagent child 的父 record 归属与终态时间。child 没有自己的 record，publisher 只能随父 record 释放，
   * 或在 turn 结束且无订阅者、超过 grace 后由低频 tick 释放；否则会驻留到进程退出。
   */
  readonly detachedChildParent = new Map<string, string>();
  readonly detachedChildrenByParent = new Map<string, Set<string>>();
  readonly detachedTerminalAt = new Map<string, number>();
  /** 冷恢复协调器（既有 activation 单飞 + 错误分型）。 */
  readonly coldResume: ColdSessionResumeCoordinator;
  /** 订阅 → flush 调度状态（publisher 内部不持有定时器，调度归网关）。 */
  readonly flushStates = new Map<string, FlushState>();
  /** ACK/outbox 尚未 admission 的 control reservation 禁止被 online flush 抢先发送。 */
  readonly controlReservations = new WeakSet<object>();
  /** transport high-water pause 只按 trusted connectionId 隔离，不改变 ingest/publisher 真值。 */
  readonly pausedConnections = new Set<string>();
  /** 一个越界周期只触发一次 runtime stop；终态事件到达后解除。 */
  readonly projectionFaultedSessions = new Set<string>();
  readonly inbox: CommandInbox;
  readonly attachmentUploads: AttachmentUploadRegistry;
  readonly binaryReadCache = new Map<string, BinaryReadCacheEntry>();
  binaryReadCacheBytes = 0;
  readonly localTtft = new LocalTtftRecorder(
    localTtftNow,
    () => {
      this.host.onError?.(
        "v4.localTtft.completedCapacity",
        new Error("TTFT completed record capacity exceeded"),
      );
    },
    (facts) => {
      const parsed = localTtftFactsSchema.safeParse(facts);
      if (parsed.success) this.host.emitLocalTtftFacts?.(parsed.data);
    },
  );
  /** 高频进度事件的 index fan-out 节流（14-sessions-index「事件 fan-out 节奏」）。 */
  readonly indexFanoutThrottle = new SessionsIndexFanoutThrottle({
    publish: (sessionId) => this.publishCurrentSummaryToIndex(sessionId),
  });
  readonly attachmentPruneTimer: ReturnType<typeof setInterval>;
  readonly now: () => number;
  readonly createLogEpoch: (sessionId: string) => string;
  readonly telemetryNormalizer = new ConversationTelemetryFactNormalizer();
  readonly cuaPermissionNormalizer = new CuaPermissionObservationNormalizer();
  readonly telemetryEventIds = new Set<string>();
  disposed = false;
  constructor(
    readonly host: V4GatewayHost,
    options: ConversationV4GatewayOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createLogEpoch = options.createLogEpoch ?? defaultLogEpoch;
    this.coldResume = new ColdSessionResumeCoordinator(host);
    this.inbox = new CommandInbox({
      getRevision: (sessionId) => {
        if (!this.host.sessionExists(sessionId)) return null;
        // 已知会话但尚无事件 → 投影未建，revision 视为 0（draft 起点）。
        return this.publishers.get(sessionId)?.getSnapshot().revision ?? 0;
      },
      getLogEpoch: (sessionId) => this.publishers.get(sessionId)?.getSnapshot().logEpoch ?? null,
      validateRowTarget: (envelope) => {
        const action = rowTargetActionForCommand(envelope.type);
        if (!action || envelope.sessionId === null) return { verdict: "allow" };
        const target = (envelope.payload as { target?: ConversationRowTarget }).target;
        if (!target) return { verdict: "reject", reasonCode: "proto.invalidPayload" };
        const resolution = this.publishers
          .get(envelope.sessionId)
          ?.resolveRowActionTarget(target, action);
        if (!resolution) return { verdict: "stale", reasonCode: "proto.staleTarget" };
        if (resolution.ok) return { verdict: "allow" };
        return resolution.status === "stale"
          ? { verdict: "stale", reasonCode: resolution.reasonCode }
          : { verdict: "reject", reasonCode: resolution.reasonCode };
      },
      lookupTranscriptCommand: (key) => this.host.lookupTranscriptCommand?.(key) ?? null,
      lookupTimelineCommand: (key) => this.host.lookupTimelineCommand?.(key) ?? null,
      lookupChildCommand: (key) => this.host.lookupChildCommand?.(key) ?? null,
      lookupDiscardedCommand: (key) => this.host.lookupDiscardedCommand?.(key) ?? null,
      now: this.now,
    });
    this.attachmentUploads = new AttachmentUploadRegistry({
      now: this.now,
      putSessionAttachment: async (sessionId, input) => {
        if (!this.host.putSessionAttachment) {
          throw new Error("fault.attachment.putUnsupported");
        }
        return this.host.putSessionAttachment(sessionId, input);
      },
    });
    this.attachmentPruneTimer = setInterval(
      () => this.attachmentUploads.pruneExpired(),
      Math.min(30_000, PROTOCOL_V4_LIMITS.attachmentUploadTtlMs),
    );
    (
      this.attachmentPruneTimer as ReturnType<typeof setInterval> & { unref?: () => void }
    ).unref?.();
  }
}
export interface V4GatewayEngine
  extends
    GatewayConnectionMethods,
    GatewayIngestMethods,
    GatewayCommitWaitersMethods,
    GatewayDetachedChildrenMethods,
    GatewaySessionIndexMethods,
    GatewayWorkspaceConfigMethods,
    GatewaySubscriptionsMethods,
    GatewayWorkflowQueriesMethods,
    GatewayConversationQueriesMethods,
    GatewayAttachmentUploadMethods,
    GatewayMediaQueriesMethods,
    GatewayMediaCacheMethods,
    GatewayCommandsMethods,
    GatewayProjectionQueriesMethods,
    GatewayLifecycleMethods,
    GatewayPublisherReadinessMethods,
    GatewayHydrationMethods,
    GatewayRawSequenceMethods {}
// 非枚举原型方法共享同一 engine；处理模块仅以类型依赖 engine。
for (const methods of [
  gatewayConnection,
  gatewayIngest,
  gatewayCommitWaiters,
  gatewayDetachedChildren,
  gatewaySessionIndex,
  gatewayWorkspaceConfig,
  gatewaySubscriptions,
  gatewayWorkflowQueries,
  gatewayConversationQueries,
  gatewayAttachmentUpload,
  gatewayMediaQueries,
  gatewayMediaCache,
  gatewayCommands,
  gatewayProjectionQueries,
  gatewayLifecycle,
  gatewayPublisherReadiness,
  gatewayHydration,
  gatewayRawSequence,
]) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
    Object.defineProperty(V4GatewayEngine.prototype, name, { ...descriptor, enumerable: false });
  }
}
