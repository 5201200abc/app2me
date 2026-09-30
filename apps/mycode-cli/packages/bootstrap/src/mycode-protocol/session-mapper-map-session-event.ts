import { type MyCodeDeliveryKind, type MyCodeSessionEvent } from "@mycode/shared";
import { SessionEventType, type SessionEvent } from "@mycode/contracts";
import { mapSessionEventPayload } from "./session-mapper-map-session-event-payload.js";
import {
  asRecord,
  stringValue,
} from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";

export function mapSessionEvent(
  event: SessionEvent,
  deliveryKind?: MyCodeDeliveryKind,
  options: { seq?: number } = {},
): MyCodeSessionEvent {
  return {
    deliveryKind,
    eventId: String(event.id),
    payload: mapSessionEventPayload(event),
    seq: options.seq ?? event.sequenceNumber,
    sessionId: String(event.sessionId),
    timestamp: event.timestamp.getTime(),
    traceId: String(event.traceId),
    turnId: event.turnId ? String(event.turnId) : undefined,
    type: mapSessionEventType(event.type),
  };
}

export function mapSessionEventForProtocol(
  event: SessionEvent,
  deliveryKind?: MyCodeDeliveryKind,
  options: { seq?: number } = {},
): MyCodeSessionEvent | null {
  if (!shouldExposeSessionEventToProtocol(event)) {
    return null;
  }
  return mapSessionEvent(event, deliveryKind, options);
}

export function mapSessionEvents(
  events: readonly SessionEvent[],
  deliveryKind?: MyCodeDeliveryKind,
): MyCodeSessionEvent[] {
  return events
    .map((event) => mapSessionEventForProtocol(event, deliveryKind))
    .filter((event): event is MyCodeSessionEvent => event !== null);
}

export function shouldExposeSessionEventToProtocol(event: SessionEvent): boolean {
  if (event.type === SessionEventType.StreamingToolLedgerUpdated) {
    // 性能修复：StreamingToolLedgerUpdated 是 runtime replay 账本，常在 closed/queued/started/committed
    // 阶段携带同一份完整 tool input。UI 协议流已有 model.streaming/tool.updated 生命周期，
    // 继续透出会造成大参数反复全量跨进程传输，且 mapper 最终也不会消费这些内部状态。
    return false;
  }

  if (event.type === SessionEventType.DynamicWorkflowRunProgress) {
    // 与上面同一个 seam、同一个理由：workflow run 事件对 v3 完全同构——v4 面已有权威投影
    // （workflowRuns 状态键），v3 mapper 不消费这些内部状态，继续透出只是把每个节点相位
    // 迁移都跨进程搬一遍。**注意与前置特性的偏斜危害不同**：这里的剥离不是为了防丢事件，
    // 新类型不会被 v3 拒收（mapSessionEventType 的 default 落到 session.updated，其 payload
    // 是宽松的 jsonObjectSchema），纯粹是带宽与语义干净。
    return false;
  }

  if (event.type !== SessionEventType.ModelStreaming) {
    return true;
  }

  const payload = asRecord(event.payload);
  const kind = stringValue(payload.kind);
  const delta = stringValue(payload.delta);
  // UI 已支持工具参数预览后，tool_input_* 不能再在协议边界丢弃；
  // 否则 Write/Edit 会在模型思考阶段完全不可见。小包压力由 runtime 合并 delta 控制。
  if (kind === "text_delta" || kind === "reasoning_delta") {
    return Boolean(delta);
  }
  return (
    kind === "tool_input_start" ||
    kind === "tool_input_delta" ||
    kind === "tool_input_end" ||
    kind === "tool_call"
  );
}

export function mapSessionEventType(type: SessionEvent["type"]): MyCodeSessionEvent["type"] {
  switch (type) {
    case SessionEventType.SessionCreated:
      return "session.created";
    case SessionEventType.SessionResumed:
      return "session.resumed";
    case SessionEventType.SessionTitleUpdated:
      return "session.titleUpdated";
    case SessionEventType.SessionEnded:
      return "session.closed";
    case SessionEventType.TurnStarted:
      return "turn.started";
    case SessionEventType.TurnSteerQueued:
      return "turn.steerQueued";
    case SessionEventType.TurnSteerDrained:
      return "turn.steerDrained";
    case SessionEventType.TurnComplete:
      return "turn.completed";
    case SessionEventType.TurnError:
      return "turn.failed";
    case SessionEventType.UserMessage:
    case SessionEventType.AssistantMessage:
    case SessionEventType.SystemMessage:
      return "message.upserted";
    case SessionEventType.ModelStreaming:
      return "model.streaming";
    case SessionEventType.ToolCallScheduled:
    case SessionEventType.ToolCallStarted:
    case SessionEventType.ToolCallProgress:
    case SessionEventType.ToolCallResult:
    case SessionEventType.ToolCallError:
    case SessionEventType.ToolBatchComplete:
      return "tool.updated";
    case SessionEventType.PermissionRequested:
      return "permission.requested";
    case SessionEventType.PermissionResolved:
    case SessionEventType.PermissionDenied:
      return "permission.resolved";
    case SessionEventType.CheckpointCreated:
      return "checkpoint.created";
    case SessionEventType.RewindTriggered:
      return "rewind.triggered";
    case SessionEventType.StreamRecoveryAnchorCreated:
    case SessionEventType.StreamRecoveryStarted:
    case SessionEventType.StreamRecoveryAnchorSelected:
    case SessionEventType.StreamRecoveryRetryStarted:
    case SessionEventType.StreamRecoveryTailDiscarded:
    case SessionEventType.StreamRecoveryBlocked:
      return "streamRecovery.updated";
    default:
      return "session.updated";
  }
}
