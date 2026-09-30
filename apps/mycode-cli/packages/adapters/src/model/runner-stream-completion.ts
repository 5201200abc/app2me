import { classifyModelFailure } from "./failure-classifier.js";

import {
  isZeroOutputModelCompletion,
  isSuspiciousStreamDiagnostics,
  logStreamDiagnostics,
} from "./runner-diagnostics.js";
import { canRetryEmptyCompletion, scheduleEmptyCompletionRetry } from "./empty-completion-retry.js";

import { recordStreamTextDebug } from "./runner-debug.js";

import { detectProviderBusinessFinishError } from "./provider-finish-business-error.js";
import { TerminalStreamChunkError, toAdapterError } from "./runner-retry.js";
import { publishModelStatus } from "./runner-status.js";

import type { AiSdkStreamTextResult } from "./runner-runtime.js";

import { providerRequestIdFromHeaders } from "./runner-telemetry.js";

import {
  statusPublishOptions,
  compactStreamFailureContext,
} from "./runner-stream-stream-failure-phase.js";

import { resolveStreamResponseHeaders } from "./runner-stream-close-stream-iterator-best-effort.js";

import type {
  StreamAttemptOutcome,
  StreamAttemptPhaseContext,
} from "./runner-stream-phase-types.js";
export async function completeStreamAttempt(
  context: StreamAttemptPhaseContext,
  outcome: StreamAttemptOutcome,
  streamResult: AiSdkStreamTextResult,
): Promise<boolean> {
  const {
    input,
    attempt,
    startedAt,
    recordModelIO,
    isDev,
    resolved,
    options,
    requestHeaders,
    requestHeaderCount,
    emittedError,
    emittedEvent,
    diagnostics,
    toolCallAssembler,
    attemptRequest,
    retryBudgetAttempt,
    streamOutputCommitted,
    timeToFirstProviderEventMs,
    timeToFirstContentMs,
    timeToFirstTextMs,
    streamMaxIdleMs,
    streamStallCount,
    emptyCompletionRetryCount,
    onEmptyCompletionRetry,
    admission,
  } = context;
  if (!emittedError) {
    // 自然 EOF 后合成的业务错误会通过 TerminalStreamChunkError 直接离开外层 catch；
    // compact 上下文在普通主链路为空，因此必须在合成现场显式保留 stream 阶段。
    // 先识别 provider business error，再考虑 generic empty；否则额度等
    // HTTP 200 空流会被误判成可重试的暂时性空响应。
    const hiddenProviderBusinessError = detectProviderBusinessFinishError({
      providerId: String(outcome.statusContext.providerId),
      providerKind: outcome.statusContext.providerKind,
      source:
        diagnostics.lastFinishChunk ??
        ({
          type: "finish",
          finishReason: diagnostics.finishReason,
          rawFinishReason: diagnostics.rawFinishReason,
        } satisfies Record<string, unknown>),
    });
    if (hiddenProviderBusinessError) {
      const failure = classifyModelFailure(hiddenProviderBusinessError, input.request.abortSignal);
      throw new TerminalStreamChunkError(
        toAdapterError(hiddenProviderBusinessError, failure, outcome.statusContext, attempt, {
          ...compactStreamFailureContext(
            input.request.preserveProviderStreamBoundaries,
            "response_body",
          ),
          errorPhase: "stream",
        }),
      );
    }

    if (isSuspiciousStreamDiagnostics(diagnostics)) {
      // 403 JSON 等业务错误有时不会让 AI SDK 抛出 error chunk，流会以空 completion 结束；
      // 若不在 adapter 层终止，core 会误报 “Model returned no text...”。
      const streamEndedWithoutOutputError = detectProviderBusinessFinishError({
        providerId: String(outcome.statusContext.providerId),
        providerKind: outcome.statusContext.providerKind,
        source: diagnostics.lastErrorChunk ?? diagnostics.lastFinishChunk,
      });
      if (streamEndedWithoutOutputError) {
        const failure = classifyModelFailure(
          streamEndedWithoutOutputError,
          input.request.abortSignal,
        );
        throw new TerminalStreamChunkError(
          toAdapterError(streamEndedWithoutOutputError, failure, outcome.statusContext, attempt, {
            ...compactStreamFailureContext(
              input.request.preserveProviderStreamBoundaries,
              "response_body",
            ),
            errorPhase: "stream",
          }),
        );
      }

      if (
        input.request.preserveProviderStreamBoundaries !== true &&
        isZeroOutputModelCompletion({
          finishReason: diagnostics.finishReason,
          reasoningLength: diagnostics.reasoningDeltaChars,
          textLength: diagnostics.textDeltaChars,
          toolCallCount: diagnostics.toolCallCount,
          usage: diagnostics.usage,
        }) &&
        canRetryEmptyCompletion({
          abortSignal: input.request.abortSignal,
          attempt,
          maxAttempts: input.retry.maxAttempts,
          retryCount: emptyCompletionRetryCount,
        })
      ) {
        const responseHeaders = await resolveStreamResponseHeaders(streamResult);
        const completedAt = Date.now();
        // finish 会把 retry-safe 前奏刷成可见事件；空 completion 需在
        // flush 前进入一次 adapter retry，避免 core 把第一次 attempt 当成已完成。
        logStreamDiagnostics({
          attempt,
          diagnostics,
          durationMs: completedAt - startedAt,
          emittedError,
          emittedEvent,
          logger: input.logger,
          outboundHeaders: resolved.headers,
          statusContext: outcome.statusContext,
        });
        onEmptyCompletionRetry();
        await scheduleEmptyCompletionRetry({
          abortSignal: input.request.abortSignal,
          attempt,
          completedAt,
          errorPhase: "stream",
          logger: input.logger,
          requestHeaders,
          requestStatusSink: input.request.statusSink,
          responseHeaders,
          retry: input.retry,
          retryBudgetAttempt,
          startedAt,
          statusContext: outcome.statusContext,
          statusSink: input.statusSink,
          streamOutputCommitted: false,
        });
        return true;
      }
    }
  }
  logStreamDiagnostics({
    attempt,
    diagnostics,
    durationMs: Date.now() - startedAt,
    emittedError,
    emittedEvent,
    logger: input.logger,
    outboundHeaders: resolved.headers,
    statusContext: outcome.statusContext,
  });
  if (!emittedError) {
    const completedAt = Date.now();
    const responseHeaders = await resolveStreamResponseHeaders(streamResult);
    await publishModelStatus(
      {
        ...outcome.statusContext,
        attempt,
        durationMs: completedAt - startedAt,
        requestHeaderCount,
        requestHeaders,
        responseHeaderCount: Object.keys(responseHeaders).length,
        responseHeaders,
        providerRequestId: providerRequestIdFromHeaders(responseHeaders),
        finishReason: diagnostics.finishReason,
        usage: diagnostics.usage,
        timeToFirstProviderEventMs,
        timeToFirstContentMs,
        timeToFirstTextMs,
        streamMaxIdleMs: streamMaxIdleMs || undefined,
        streamStallCount,
        streamOutputCommitted,
        timestamp: new Date(completedAt).toISOString(),
        type: "model_request_completed",
      },
      statusPublishOptions(input, admission),
    );
    outcome.terminalStatusPublished = true;
  }
  if (recordModelIO && options) {
    await recordStreamTextDebug({
      modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
      attempt,
      debugDir: input.debugDir,
      isDev,
      normalizedToolCalls: toolCallAssembler.snapshotNormalizedToolCalls(),
      options,
      recordModelIO,
      request: attemptRequest,
      requestId: outcome.statusContext.requestId,
      resolved,
      result: streamResult,
      startedAt,
    });
  }
  return false;
}
