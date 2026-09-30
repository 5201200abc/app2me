import type {
  CompactLifecyclePayload,
  DynamicWorkflowRunProgressPayload,
  PermissionDeniedPayload,
  PermissionRequestedPayload,
  PermissionResolvedPayload,
  SessionEvent,
} from "@mycode/contracts";
import { SessionEventType } from "@mycode/contracts";
import { workflowLifecycleFactFromProgress } from "./conversation-telemetry-workflow-facts.js";
import {
  conversationTelemetryFactSchema,
  type ConversationTelemetryFact,
} from "@mycode/shared/mycode-protocol-v4";
import {
  optionalString,
  recordValue,
  compactTerminalStatus,
} from "./conversation-telemetry-facts-streaming-parent-tool-call-id.js";

type ConversationFactBase = Pick<
  ConversationTelemetryFact,
  "version" | "eventId" | "eventSeq" | "occurredAt" | "sessionId" | "turnId" | "memoryEnabled"
>;

export function permissionLifecycleFact(
  base: ConversationFactBase,
  event: SessionEvent,
  sourceCommandId?: string,
): ConversationTelemetryFact | null {
  const payload = event.payload as
    | PermissionRequestedPayload
    | PermissionResolvedPayload
    | PermissionDeniedPayload;

  const rawPayload = recordValue(payload);

  const requested =
    event.type === SessionEventType.PermissionRequested
      ? (payload as PermissionRequestedPayload)
      : null;

  const resolved =
    event.type === SessionEventType.PermissionResolved
      ? (payload as PermissionResolvedPayload)
      : null;

  const denied =
    event.type === SessionEventType.PermissionDenied ? (payload as PermissionDeniedPayload) : null;

  return conversationTelemetryFactSchema.parse({
    ...base,
    kind: "permission.lifecycle",
    ...(sourceCommandId ? { sourceCommandId } : {}),
    phase: requested ? "requested" : resolved ? "resolved" : "denied",
    ...(optionalString(requested?.requestId ?? resolved?.requestId)
      ? { requestId: optionalString(requested?.requestId ?? resolved?.requestId) }
      : {}),
    toolCallId: String(payload.toolCallId),
    ...(requested?.toolName
      ? { toolName: requested.toolName }
      : denied?.toolName
        ? { toolName: denied.toolName }
        : {}),
    ...(optionalString(rawPayload.childSessionId)
      ? { childSessionId: optionalString(rawPayload.childSessionId) }
      : {}),
    ...(rawPayload.background === true ? { background: true } : {}),
    ...(resolved ? { decision: resolved.decision } : {}),
  });
}
export function agentLifecycleFact(
  base: ConversationFactBase,
  event: SessionEvent,
  sourceCommandId?: string,
): ConversationTelemetryFact | null {
  if (event.type === SessionEventType.DynamicWorkflowRunProgress) {
    // 动态工作流子代理的归属事实：actor-created 登记、
    // run-settled 结算；其余引擎事件不进埋点。
    return workflowLifecycleFactFromProgress(
      base,
      event.payload as DynamicWorkflowRunProgressPayload,
    );
  }

  const payload = recordValue(event.payload);

  const agentId = optionalString(payload.agentId);

  const childSessionId = optionalString(payload.childSessionId);

  if (!agentId || !childSessionId) return null;

  return conversationTelemetryFactSchema.parse({
    ...base,
    kind: "subagent.lifecycle",
    ...(sourceCommandId ? { sourceCommandId } : {}),
    phase: event.type === SessionEventType.SubagentSpawned ? "spawned" : "stopped",
    agentId,
    ...(optionalString(payload.agentType) ? { agentType: optionalString(payload.agentType) } : {}),
    childSessionId,
    ...(optionalString(payload.parentToolCallId)
      ? { parentToolCallId: optionalString(payload.parentToolCallId) }
      : {}),
    background: payload.background === true,
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    // stopped 可独立收口后台埋点；保留 Runtime 已有错误，避免失败汇总丢失原因。
    ...(event.type === SessionEventType.SubagentStopped && optionalString(payload.error)
      ? { errorMessage: optionalString(payload.error) }
      : {}),
  });
}
export function compactLifecycleFact(
  base: ConversationFactBase,
  event: SessionEvent,
  getObservedModel: () => { modelName: string; modelProvider: string } | undefined,
  runtimeMetadata?: { modelName?: string; modelProvider?: string },
): ConversationTelemetryFact | null {
  const payload = event.payload as CompactLifecyclePayload;

  const status = compactTerminalStatus(payload.status);

  if (!status) return null;

  const observedModel = getObservedModel();

  const model =
    observedModel ??
    (runtimeMetadata?.modelName || runtimeMetadata?.modelProvider
      ? {
          modelName: runtimeMetadata.modelName ?? "",
          modelProvider: runtimeMetadata.modelProvider ?? "",
        }
      : undefined);

  return conversationTelemetryFactSchema.parse({
    ...base,
    kind: "compaction.terminal",
    ...(payload.sourceCommandId ? { sourceCommandId: payload.sourceCommandId } : {}),
    operationId: payload.operationId,
    ...(payload.messageId ? { messageId: String(payload.messageId) } : {}),
    ...(payload.summaryMessageId ? { summaryMessageId: String(payload.summaryMessageId) } : {}),
    status,
    trigger: payload.trigger,
    ...(payload.compactReason ? { compactReason: payload.compactReason } : {}),
    ...(payload.reason ? { reason: payload.reason } : {}),
    ...(payload.attempt !== undefined ? { attempt: payload.attempt } : {}),
    ...(payload.maxAttempts !== undefined ? { maxAttempts: payload.maxAttempts } : {}),
    ...(payload.startedAt !== undefined ? { startedAt: payload.startedAt } : {}),
    ...(payload.endedAt !== undefined ? { endedAt: payload.endedAt } : {}),
    ...(payload.preCompactTokenCount !== undefined
      ? { preCompactTokenCount: payload.preCompactTokenCount }
      : {}),
    ...(payload.postCompactTokenCount !== undefined
      ? { postCompactTokenCount: payload.postCompactTokenCount }
      : {}),
    ...(payload.truePostCompactTokenCount !== undefined
      ? { truePostCompactTokenCount: payload.truePostCompactTokenCount }
      : {}),
    ...(model ? model : {}),
  });
}
