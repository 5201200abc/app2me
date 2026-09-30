import {
  permissionLifecycleFact,
  agentLifecycleFact,
  compactLifecycleFact,
} from "./conversation-telemetry-lifecycle-facts.js";
import type {
  ModelCompletePayload,
  ModelNetworkStatusPayload,
  ModelStreamingPayload,
  SessionEvent,
  ToolCallErrorPayload,
  ToolCallProgressPayload,
  ToolCallResultPayload,
  ToolCallScheduledPayload,
  ToolCallStartedPayload,
  TurnCompletePayload,
  TurnErrorPayload,
  TurnStartedPayload,
} from "@mycode/contracts";
import { SessionEventType } from "@mycode/contracts";

import {
  conversationTelemetryFactSchema,
  type ConversationTelemetryFact,
} from "@mycode/shared/mycode-protocol-v4";
import {
  BoundedKeySet,
  BoundedValueMap,
  type CompletedModelRequestIdentity,
  eventTimestamp,
  optionalString,
  automationAdmission,
  providerHostname,
  isStepUsageQuerySource,
  modelRequestQueueKey,
  recordValue,
  streamingParentToolCallId,
  mirroredSubagentToolFields,
  toToolPerformanceFact,
  cronCreateAutomationId,
  skillTelemetryFactFields,
  isStepUsageModelComplete,
  nonNegative,
  totalTokensOf,
  terminalStatus,
} from "./conversation-telemetry-facts-streaming-parent-tool-call-id.js";

/**
 * 把本进程 live SessionEvent 中的轮次起止归一成 `turn.started` / `turn.terminal` 事实，
 * 供 App/服务端统计运行中的会话数。事实不带正文，只带 admission 给出的 inputId 与终态摘要。
 * 该类不读取 transcript/snapshot，因而无法在 hydration/recovery 时补造事件。
 */
export class ConversationTelemetryFactNormalizer {
  private readonly firstStreamChunks = new BoundedKeySet();
  private readonly sourceCommandByTurn = new BoundedValueMap<string>();
  private readonly toolNameByCall = new BoundedValueMap<string>();
  private readonly modelBySession = new BoundedValueMap<{
    modelName: string;
    modelProvider: string;
  }>();
  private readonly completedModelRequests = new BoundedValueMap<CompletedModelRequestIdentity[]>();

  normalize(
    sessionId: string,
    event: SessionEvent,
    runtimeMetadata?: { modelName?: string; modelProvider?: string; memoryEnabled?: boolean },
  ): ConversationTelemetryFact | null {
    const turnId = event.turnId ? String(event.turnId) : undefined;
    const turnKey = turnId ? `${sessionId}\0${turnId}` : undefined;
    const base = {
      ...(runtimeMetadata?.memoryEnabled !== undefined
        ? { memoryEnabled: runtimeMetadata.memoryEnabled }
        : {}),
      version: 1 as const,
      eventId: String(event.id),
      eventSeq: Math.max(0, Math.floor(event.sequenceNumber)),
      occurredAt: eventTimestamp(event),
      sessionId,
      ...(turnId ? { turnId } : {}),
    };
    const sourceCommandId = turnKey ? this.sourceCommandByTurn.get(turnKey) : undefined;

    switch (event.type) {
      case SessionEventType.TurnStarted: {
        const payload = event.payload as TurnStartedPayload;
        const backgroundSource =
          payload.backgroundSource === "bash" ||
          payload.backgroundSource === "subagent" ||
          payload.backgroundSource === "workflow"
            ? payload.backgroundSource
            : undefined;
        // 用户轮与 background wake 均由 admission 提供 inputId，不混用持久化 messageId。
        const inputId = optionalString(payload.inputId);
        if (turnKey && inputId) this.sourceCommandByTurn.set(turnKey, inputId);
        return conversationTelemetryFactSchema.parse({
          ...base,
          kind: "turn.started",
          ...(inputId ? { sourceCommandId: inputId } : {}),
          ...automationAdmission(inputId, optionalString(payload.automationId)),
          ...(optionalString(payload.offPeakTaskId)
            ? { offPeakTaskId: optionalString(payload.offPeakTaskId) }
            : {}),
          ...(payload.offPeakRunType ? { offPeakRunType: payload.offPeakRunType } : {}),
          ...(payload.executionKind ? { executionKind: payload.executionKind } : {}),
          ...(payload.inputSource ? { inputSource: payload.inputSource } : {}),
          ...(backgroundSource ? { backgroundSource } : {}),
        });
      }
      case SessionEventType.ModelNetworkStatus: {
        const payload = event.payload as ModelNetworkStatusPayload;
        // 准入等待的两端不是 provider 请求状态：
        // fact 的 status 枚举不收它们，显式跳过而不是让 schema.parse 抛出。
        if (payload.type === "model_request_queued" || payload.type === "model_request_admitted") {
          return null;
        }
        const modelProvider = String(payload.providerId);
        const modelName = String(payload.modelId);
        this.modelBySession.set(sessionId, { modelName, modelProvider });
        const fact = conversationTelemetryFactSchema.parse({
          ...base,
          kind: "model.request.status",
          ...(sourceCommandId ? { sourceCommandId } : {}),
          requestId: String(payload.requestId),
          status: payload.type,
          providerId: modelProvider,
          modelId: modelName,
          ...(payload.providerKind ? { providerKind: payload.providerKind } : {}),
          ...(providerHostname(payload.baseURL)
            ? { providerHostname: providerHostname(payload.baseURL) }
            : {}),
          transport: payload.transport,
          ...(payload.querySource ? { querySource: payload.querySource } : {}),
          ...(payload.queryId ? { queryId: String(payload.queryId) } : {}),
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
          ...(payload.type === "model_request_completed"
            ? {
                durationMs: payload.durationMs,
              }
            : {}),
          ...(payload.type === "model_request_failed"
            ? {
                ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
                reason: payload.reason,
                retryable: payload.retryable,
                ...(payload.statusCode !== undefined ? { statusCode: payload.statusCode } : {}),
              }
            : {}),
          ...(payload.type === "model_retry_scheduled"
            ? {
                delayMs: payload.delayMs,
                nextAttempt: payload.nextAttempt,
                reason: payload.reason,
                ...(payload.statusCode !== undefined ? { statusCode: payload.statusCode } : {}),
              }
            : {}),
          ...(payload.type === "model_stream_stalled"
            ? { idleMs: payload.idleMs, timeoutMs: payload.timeoutMs }
            : {}),
        });
        const querySource = optionalString(payload.querySource);
        if (payload.type === "model_request_completed" && isStepUsageQuerySource(querySource)) {
          const key = modelRequestQueueKey(sessionId, querySource);
          const queue = this.completedModelRequests.get(key) ?? [];
          queue.push({
            requestId: String(payload.requestId),
            providerId: modelProvider,
            modelId: modelName,
            ...(payload.providerKind ? { providerKind: payload.providerKind } : {}),
            ...(providerHostname(payload.baseURL)
              ? { providerHostname: providerHostname(payload.baseURL) }
              : {}),
          });
          this.completedModelRequests.set(key, queue);
        }
        return fact;
      }
      case SessionEventType.ModelStreaming: {
        const payload = event.payload as ModelStreamingPayload;
        const rawPayload = recordValue(event.payload);
        const channel =
          payload.kind === "text_delta"
            ? "text"
            : payload.kind === "reasoning_delta"
              ? "thought"
              : null;
        if (!channel) return null;
        const parentToolCallId = streamingParentToolCallId(rawPayload);
        const streamKey = `${sessionId}\0${turnId ?? ""}\0${channel}\0${String(payload.partId ?? "")}\0${parentToolCallId ?? ""}`;
        return conversationTelemetryFactSchema.parse({
          ...base,
          kind: "stream.chunk",
          ...(sourceCommandId ? { sourceCommandId } : {}),
          channel,
          chunkLength: payload.delta.length,
          firstChunk: this.firstStreamChunks.add(streamKey),
          ...(payload.assistantMessageId
            ? { assistantMessageId: String(payload.assistantMessageId) }
            : {}),
          ...(payload.partId ? { partId: String(payload.partId) } : {}),
          ...(parentToolCallId ? { parentToolCallId } : {}),
        });
      }
      case SessionEventType.ToolCallScheduled: {
        const payload = event.payload as ToolCallScheduledPayload;
        const rawPayload = recordValue(event.payload);
        const toolCallId = String(payload.toolCallId);
        this.toolNameByCall.set(`${turnKey ?? sessionId}\0${toolCallId}`, payload.toolName);
        return conversationTelemetryFactSchema.parse({
          ...base,
          kind: "tool.lifecycle",
          ...(sourceCommandId ? { sourceCommandId } : {}),
          phase: "scheduled",
          toolCallId,
          toolName: payload.toolName,
          ...mirroredSubagentToolFields(rawPayload),
        });
      }
      case SessionEventType.ToolCallStarted:
      case SessionEventType.ToolCallProgress:
      case SessionEventType.ToolCallResult:
      case SessionEventType.ToolCallError: {
        const payload = event.payload as
          | ToolCallStartedPayload
          | ToolCallProgressPayload
          | ToolCallResultPayload
          | ToolCallErrorPayload;
        const rawPayload = recordValue(event.payload);
        const toolCallId = String(payload.toolCallId);
        const key = `${turnKey ?? sessionId}\0${toolCallId}`;
        const explicitName = "toolName" in payload ? optionalString(payload.toolName) : undefined;
        const toolName = explicitName ?? this.toolNameByCall.get(key);
        const result =
          event.type === SessionEventType.ToolCallResult
            ? (payload as ToolCallResultPayload)
            : null;
        const error =
          event.type === SessionEventType.ToolCallError ? (payload as ToolCallErrorPayload) : null;
        const display = recordValue(result?.result.display);
        // runtime 把 perf 改为 nested detail，旧 normalizer 仍把它
        // 原样塞进扁平 strict fact，导致整条工具终态被丢弃。这里必须只做显式白名单映射，
        // 不能再次透传 detail 或本地诊断用的 command.hash。
        const performance = toToolPerformanceFact(result?.result.perf);
        const phase =
          event.type === SessionEventType.ToolCallStarted
            ? "started"
            : event.type === SessionEventType.ToolCallProgress
              ? "progress"
              : event.type === SessionEventType.ToolCallResult
                ? result?.result.success === false
                  ? "failed"
                  : "completed"
                : "failed";
        const automationId =
          phase === "completed" && toolName === "CronCreate"
            ? cronCreateAutomationId(result?.result.content)
            : undefined;
        if (phase === "completed" || phase === "failed") this.toolNameByCall.delete(key);
        return conversationTelemetryFactSchema.parse({
          ...base,
          kind: "tool.lifecycle",
          ...(sourceCommandId ? { sourceCommandId } : {}),
          phase,
          toolCallId,
          ...(toolName ? { toolName } : {}),
          ...(automationId ? { automationId } : {}),
          ...(result ? { durationMs: result.duration } : {}),
          ...(error ? { errorCode: error.error.code ?? error.error.type } : {}),
          ...(error ? { errorMessage: error.error.message } : {}),
          ...(result?.result.error
            ? { errorCode: result.result.error.code ?? result.result.error.type }
            : {}),
          ...(result?.result.error ? { errorMessage: result.result.error.message } : {}),
          ...skillTelemetryFactFields(toolName, error?.skillMetadata ?? result?.skillMetadata),
          // subagent mirror 把父子关联放在工具事件 payload 顶层，旧 normalizer
          // 只读取 result.display，导致 agent_id 等字段在进入 agent_step 前被静默丢弃。
          ...mirroredSubagentToolFields(rawPayload, display),
          ...(performance ? { performance } : {}),
        });
      }
      case SessionEventType.PermissionRequested:
      case SessionEventType.PermissionResolved:
      case SessionEventType.PermissionDenied: {
        return permissionLifecycleFact(base, event, sourceCommandId);
      }
      case SessionEventType.ModelComplete: {
        const payload = event.payload as ModelCompletePayload;
        const requestQueueKey = modelRequestQueueKey(
          sessionId,
          optionalString(payload.querySource),
        );
        const completedRequests = this.completedModelRequests.get(requestQueueKey) ?? [];
        const completedRequest = completedRequests.shift();
        if (completedRequests.length > 0) {
          this.completedModelRequests.set(requestQueueKey, completedRequests);
        } else {
          this.completedModelRequests.delete(requestQueueKey);
        }
        // 标题 sidecar 沿用当前 turnId，若把它的 ModelComplete 也转成
        // usage.delta，renderer 会把每轮标题的 64/8 tokens 累加进主对话 completion。
        // 本期只放行主轮和 subagent request usage；sidecar/compact/tool_internal 仍不外送。
        if (!isStepUsageModelComplete(payload)) return null;
        const usage = recordValue(payload.usage);
        return conversationTelemetryFactSchema.parse({
          ...base,
          kind: "usage.delta",
          ...(sourceCommandId ? { sourceCommandId } : {}),
          ...(completedRequest
            ? {
                requestId: completedRequest.requestId,
                providerId: completedRequest.providerId,
                modelId: completedRequest.modelId,
                ...(completedRequest.providerKind
                  ? { providerKind: completedRequest.providerKind }
                  : {}),
                ...(completedRequest.providerHostname
                  ? { providerHostname: completedRequest.providerHostname }
                  : {}),
              }
            : {}),
          inputTokens: nonNegative(usage.inputTokens) ?? 0,
          outputTokens: nonNegative(usage.outputTokens) ?? 0,
          totalTokens: totalTokensOf(usage),
          reasoningTokens: nonNegative(usage.reasoningTokens) ?? 0,
          cacheReadTokens:
            nonNegative(usage.cacheReadTokens) ?? nonNegative(usage.cacheTokens) ?? 0,
          cacheWriteTokens: nonNegative(usage.cacheWriteTokens) ?? 0,
        });
      }
      case SessionEventType.DynamicWorkflowRunProgress:
      case SessionEventType.SubagentSpawned:
      case SessionEventType.SubagentStopped: {
        return agentLifecycleFact(base, event, sourceCommandId);
      }
      case SessionEventType.TurnComplete: {
        const payload = event.payload as TurnCompletePayload;
        const directSourceCommandId = optionalString(payload.inputId) ?? sourceCommandId;
        const fact = conversationTelemetryFactSchema.parse({
          ...base,
          kind: "turn.terminal",
          ...(directSourceCommandId ? { sourceCommandId: directSourceCommandId } : {}),
          status: terminalStatus(payload.resultType),
          resultType: payload.resultType,
          durationMs: payload.duration,
          tokenCount: payload.tokenCount,
          toolCallCount: payload.toolCallCount,
          ...(payload.resultType === "cancelled"
            ? {
                errorCode: "USER_INTERRUPT",
                errorMessage: "User stopped generation",
              }
            : {}),
          ...(payload.backgroundSubagentResultConsumed
            ? { backgroundSubagentResultConsumed: true }
            : {}),
          ...(payload.workflowResultConsumed ? { workflowResultConsumed: true } : {}),
        });
        this.clearTurn(turnKey);
        return fact;
      }
      case SessionEventType.TurnError: {
        const payload = event.payload as TurnErrorPayload;
        const directSourceCommandId = optionalString(payload.inputId) ?? sourceCommandId;
        const fact = conversationTelemetryFactSchema.parse({
          ...base,
          kind: "turn.terminal",
          ...(directSourceCommandId ? { sourceCommandId: directSourceCommandId } : {}),
          status: "failed",
          errorCode: payload.error.code ?? payload.error.type,
          errorMessage: payload.error.message,
          ...(payload.error.retryable !== undefined
            ? { errorRetryable: payload.error.retryable }
            : {}),
          ...(payload.backgroundSubagentResultConsumed
            ? { backgroundSubagentResultConsumed: true }
            : {}),
          ...(payload.workflowResultConsumed ? { workflowResultConsumed: true } : {}),
          turnPhase: payload.turnPhase,
        });
        this.clearTurn(turnKey);
        return fact;
      }
      case SessionEventType.CompactCompleted:
      case SessionEventType.CompactFailed: {
        return compactLifecycleFact(
          base,
          event,
          () => this.modelBySession.get(sessionId),
          runtimeMetadata,
        );
      }
      default:
        return null;
    }
  }

  private clearTurn(turnKey: string | undefined): void {
    if (!turnKey) return;
    this.sourceCommandByTurn.delete(turnKey);
    this.firstStreamChunks.deletePrefix(`${turnKey}\0`);
    this.toolNameByCall.deletePrefix(`${turnKey}\0`);
  }

  clearSession(sessionId: string): void {
    const prefix = `${sessionId}\0`;
    this.sourceCommandByTurn.deletePrefix(prefix);
    this.firstStreamChunks.deletePrefix(prefix);
    this.toolNameByCall.deletePrefix(prefix);
    this.modelBySession.delete(sessionId);
    this.completedModelRequests.deletePrefix(prefix);
  }
}

export { streamingParentToolCallId } from "./conversation-telemetry-facts-streaming-parent-tool-call-id.js";
