import {
  SessionEventType,
  createModelUsageSummaryFromEvents,
  traceContextToLogContext,
} from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { isModelContextExceededError } from "../helpers/index.js";
import {
  type RecordTurnUsageInput,
  usageStoreFor,
  firstModelTokenAt,
  errorInfoFor,
  modelNetworkEvents,
} from "./usage-observability-record-model-usage-fact.js";

export async function recordTurnUsageFact(
  runtime: AgentRuntimeInternal,
  input: RecordTurnUsageInput,
): Promise<void> {
  const usageStore = usageStoreFor(runtime);
  if (!usageStore) return;

  const usage = createModelUsageSummaryFromEvents(input.events);
  const modelRequests = input.events.filter(
    (event) => event.type === SessionEventType.ModelRequest,
  );
  const firstModelStartAt = modelRequests[0]?.timestamp.getTime();
  const firstTokenAt = firstModelTokenAt(input.events, 0);
  const toolScheduledIds = new Set<string>();
  const toolErrorIds = new Set<string>();
  for (const event of input.events) {
    if (event.type === SessionEventType.ToolCallScheduled) {
      const payload = event.payload as { toolCallId?: string };
      if (payload.toolCallId) toolScheduledIds.add(payload.toolCallId);
    }
    if (event.type === SessionEventType.ToolCallError) {
      const payload = event.payload as { toolCallId?: string };
      if (payload.toolCallId) toolErrorIds.add(payload.toolCallId);
    }
  }

  const errorInfo = errorInfoFor(input.error, undefined);
  const contextExceeded = isModelContextExceededError(input.error);

  try {
    await usageStore.upsertTurnUsage({
      sessionID: runtime.sessionId,
      turnID: input.turnId,
      traceID: input.traceContext.traceId,
      userMessageID: input.userMessageId,
      status: input.status,
      startedAt: input.startedAt,
      firstModelStartAt,
      firstTokenAt,
      completedAt: input.completedAt,
      durationMs: input.completedAt - input.startedAt,
      timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - input.startedAt,
      modelRequestCount: modelRequests.length,
      modelRetryCount: modelNetworkEvents(input.events).filter(
        (event) => event.type === "model_retry_scheduled",
      ).length,
      toolCallCount: toolScheduledIds.size,
      toolErrorCount: toolErrorIds.size,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens,
      cacheCreationInputTokens: usage?.cacheWriteTokens,
      cacheReadInputTokens: usage?.cacheReadTokens,
      computedTotalTokens: usage?.totalTokens,
      retryable: errorInfo.retryable,
      cancelledByUser: input.status === "cancelled",
      contextExceeded,
      errorType: errorInfo.type,
      errorCode: errorInfo.code,
    });
  } catch (error) {
    runtime.logger?.warn("Usage turn fact write failed", {
      ...traceContextToLogContext(input.traceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "usage.turn.write.failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

export function toolUsageId(sessionId: string, toolCallId: string): string {
  return `usage_tool_${sessionId}_${toolCallId}`;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
