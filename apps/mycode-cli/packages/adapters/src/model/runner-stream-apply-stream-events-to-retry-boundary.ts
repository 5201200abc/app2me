import type { Logger, ModelStatusSink, ModelStreamEvent } from "@mycode/contracts";
import { classifyModelFailure } from "./failure-classifier.js";
import { isRetrySafePreludeStreamEvent } from "./stream-retry-boundary.js";
import { type AttemptAdmission } from "./request-admission.js";
import { TerminalStreamChunkError } from "./runner-retry.js";
import { createStatusContext, publishModelStatus } from "./runner-status.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import type { AiSdkModelTextRequest } from "./runner-runtime.js";
import { statusPublishOptions } from "./runner-stream-stream-failure-phase.js";

export function applyStreamEventsToRetryBoundary(input: {
  emittedRetryBoundaryEvent: boolean;
  events: ModelStreamEvent[];
  pendingRetrySafeEvents: ModelStreamEvent[];
  providerEventObserved?: boolean;
  preserveProviderStreamBoundaries?: boolean;
}): ReturnType<typeof streamChunkResult> {
  let emittedEvent = false;
  let emittedRetryBoundaryEvent = input.emittedRetryBoundaryEvent;
  const visibleEvents: ModelStreamEvent[] = [];

  if (input.providerEventObserved && !emittedRetryBoundaryEvent) {
    visibleEvents.push(...input.pendingRetrySafeEvents.splice(0));
    emittedRetryBoundaryEvent = true;
  }

  for (const event of input.events) {
    emittedEvent = true;
    // AI SDK 的 start 在读取 provider stream 前本地合成，不能冒充首个 provider event；
    // compact 一旦收到其余真实事件就停止 SSE retry，再由 Core 的 block commit 决定能否 HTTP fallback。
    const retrySafePrelude =
      isRetrySafePreludeStreamEvent(event) &&
      (!input.preserveProviderStreamBoundaries || event.type === "start");
    if (retrySafePrelude && !emittedRetryBoundaryEvent) {
      input.pendingRetrySafeEvents.push(event);
      continue;
    }

    if (!emittedRetryBoundaryEvent) {
      visibleEvents.push(...input.pendingRetrySafeEvents.splice(0));
    }
    visibleEvents.push(event);
    emittedRetryBoundaryEvent = true;
  }

  return streamChunkResult({
    emittedEvent,
    emittedRetryBoundaryEvent,
    visibleEvents,
  });
}

export function streamChunkResult(
  overrides: Partial<{
    emittedError: boolean;
    emittedEvent: boolean;
    emittedRetryBoundaryEvent: boolean;
    retryScheduled: boolean;
    /** off-peak 排队重试：外层 for 冻结 attempt 预算。 */
    offPeakQueueHold: boolean;
    terminalError?: TerminalStreamChunkError;
    visibleEvents: ModelStreamEvent[];
  }> = {},
) {
  return {
    emittedError: false,
    emittedEvent: false,
    emittedRetryBoundaryEvent: false,
    retryScheduled: false,
    offPeakQueueHold: false,
    visibleEvents: [],
    ...overrides,
  };
}

export async function publishRetryScheduledStatus(
  input: {
    logger?: Logger;
    request: AiSdkModelTextRequest;
    retry: ResolvedAiSdkModelRetryOptions;
    statusSink?: ModelStatusSink;
  },
  statusContext: ReturnType<typeof createStatusContext>,
  attempt: number,
  delayMs: number,
  failure: ReturnType<typeof classifyModelFailure>,
  requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>,
  admission?: AttemptAdmission,
): Promise<void> {
  await publishModelStatus(
    {
      ...statusContext,
      attempt,
      delayMs,
      message: failure.message,
      nextAttempt: attempt + 1,
      reason: failure.retryReason,
      requestHeaderCount: Object.keys(requestHeaders).length,
      requestHeaders,
      responseHeaderCount: Object.keys(responseHeaders).length,
      responseHeaders,
      statusCode: failure.statusCode,
      errorCode: failure.code,
      retryAfterMs: failure.retryAfterMs,
      timestamp: new Date().toISOString(),
      type: "model_retry_scheduled",
    },
    statusPublishOptions(input, admission),
  );
}
