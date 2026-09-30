import { SessionEventType, isCoreError, traceContextToLogContext } from "../deps.js";
import type {
  MessageId,
  Model,
  SessionEvent,
  TraceContext,
  TurnId,
  UsageStorePort,
} from "@mycode/contracts";
import type { RuntimeModelTextResult } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { isModelContextExceededError } from "../helpers/index.js";

export type ModelUsageQuerySource =
  | "main_turn"
  | "compact"
  | "session_title"
  | "goal_completion_verification"
  | string;

export interface RecordModelUsageInput {
  assistantMessageId?: MessageId;
  attemptIndex?: number;
  error?: unknown;
  events: readonly SessionEvent[];
  model: Model;
  networkEventStartIndex: number;
  parentUserMessageId?: MessageId;
  querySource: ModelUsageQuerySource;
  result?: RuntimeModelTextResult;
  startedAt: number;
  status: "completed" | "error" | "cancelled";
  toolCallCount?: number;
  traceContext: TraceContext;
}

export interface RecordTurnUsageInput {
  completedAt: number;
  error?: unknown;
  events: readonly SessionEvent[];
  startedAt: number;
  status: "completed" | "error" | "cancelled";
  traceContext: TraceContext;
  turnId: TurnId;
  userMessageId?: MessageId;
}

export async function recordModelUsageFact(
  runtime: AgentRuntimeInternal,
  input: RecordModelUsageInput,
): Promise<void> {
  const usageStore = usageStoreFor(runtime);
  if (!usageStore) return;

  const completedAt = Date.now();
  const usage = input.result?.usage;
  const networkEvents = modelNetworkEvents(input.events.slice(input.networkEventStartIndex));
  const retryCount = networkEvents.filter((event) => event.type === "model_retry_scheduled").length;
  const failedNetworkEvent = networkEvents.findLast(
    (event) => event.type === "model_request_failed",
  );
  const firstTokenAt = firstModelTokenAt(input.events, input.networkEventStartIndex);
  const durationMs = completedAt - input.startedAt;
  const errorInfo = errorInfoFor(input.error, failedNetworkEvent);
  const contextExceeded =
    isModelContextExceededError(input.error) || failedNetworkEvent?.reason === "context_exceeded";

  try {
    await usageStore.recordModelUsage({
      id: modelUsageId(input),
      logicalRequestId:
        input.assistantMessageId ??
        input.traceContext.spanId ??
        `${input.querySource}:${input.startedAt}`,
      attemptIndex: input.attemptIndex,
      sessionID: runtime.sessionId,
      turnID: input.traceContext.turnId,
      traceID: input.traceContext.traceId,
      spanID: input.traceContext.spanId,
      assistantMessageID: input.assistantMessageId,
      parentUserMessageID: input.parentUserMessageId,
      querySource: input.querySource,
      providerId: input.model.providerId,
      modelId: input.model.modelId,
      reasoningLevel: input.model.options.reasoningLevel,
      agent: runtime.config.agentName ?? "mycode-agent",
      mode: runtime.config.mode ?? "build",
      taskType: runtime.config.taskType ?? "interactive",
      status: input.status,
      startedAt: input.startedAt,
      firstTokenAt,
      completedAt,
      durationMs,
      timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - input.startedAt,
      finishReason: input.result?.finishReason,
      toolCallCount: input.toolCallCount ?? 0,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens,
      cacheCreationInputTokens: usage?.cacheWriteTokens,
      cacheReadInputTokens: usage?.cacheReadTokens,
      providerTotalTokens: usage?.totalTokens,
      retryCount,
      retryable: errorInfo.retryable ?? retryCount > 0,
      cancelledByUser: input.status === "cancelled",
      contextExceeded,
      errorType: errorInfo.type,
      errorCode: errorInfo.code,
      errorMessage: errorInfo.message,
      rawUsage: usage,
      providerMetadata: input.result?.providerMetadata,
    });
  } catch (error) {
    runtime.logger?.warn("Usage model fact write failed", {
      ...traceContextToLogContext(input.traceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "usage.model.write.failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

export function usageStoreFor(runtime: AgentRuntimeInternal): UsageStorePort | undefined {
  const candidate = runtime.sessionStore as Partial<UsageStorePort> | undefined;
  return candidate?.recordModelUsage &&
    candidate.upsertTurnUsage &&
    candidate.upsertToolUsage &&
    candidate.pruneUsage
    ? (candidate as UsageStorePort)
    : undefined;
}

export function modelUsageId(input: RecordModelUsageInput): string {
  const logicalId =
    input.assistantMessageId ??
    input.traceContext.spanId ??
    `${input.querySource}_${input.startedAt}`;
  return `usage_model_${input.querySource}_${logicalId}_${input.attemptIndex ?? 0}`;
}

export function modelNetworkEvents(events: readonly SessionEvent[]) {
  return events
    .filter((event) => event.type === SessionEventType.ModelNetworkStatus)
    .map((event) => event.payload)
    .filter(
      (
        payload,
      ): payload is {
        type: string;
        reason?: string;
        retryable?: boolean;
        message?: string;
      } => Boolean(payload && typeof payload === "object" && "type" in payload),
    );
}

export function firstModelTokenAt(
  events: readonly SessionEvent[],
  startIndex: number,
): number | undefined {
  for (const event of events.slice(startIndex)) {
    if (event.type !== SessionEventType.ModelStreaming) continue;
    const payload = event.payload as { delta?: string; kind?: string };
    if (
      (payload.kind === "text_delta" || payload.kind === "reasoning_delta") &&
      payload.delta &&
      payload.delta.length > 0
    ) {
      return event.timestamp.getTime();
    }
  }
  return undefined;
}

export function errorInfoFor(
  error: unknown,
  failedNetworkEvent: { reason?: string; retryable?: boolean; message?: string } | undefined,
): { code?: string; message?: string; retryable?: boolean; type?: string } {
  if (isCoreError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      type: error.type,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      retryable: failedNetworkEvent?.retryable,
      type: failedNetworkEvent?.reason ?? error.name,
    };
  }
  if (failedNetworkEvent) {
    return {
      message: failedNetworkEvent.message,
      retryable: failedNetworkEvent.retryable,
      type: failedNetworkEvent.reason,
    };
  }
  return {};
}
