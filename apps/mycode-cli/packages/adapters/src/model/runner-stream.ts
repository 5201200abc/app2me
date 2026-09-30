import type {
  StreamRunInput,
  StreamAttemptOutcome,
  StreamAttemptPhaseContext,
} from "./runner-stream-phase-types.js";
import { completeStreamAttempt } from "./runner-stream-completion.js";
import { recoverStreamAttempt } from "./runner-stream-failure.js";
import { finalizeStreamAttempt } from "./runner-stream-finalization.js";
import { admitStreamModelAttempt } from "./runner-stream-admission.js";
import type { TextStreamPart, ToolSet } from "ai";
import type { ModelStreamEvent } from "@mycode/contracts";
import { ModelTransportKind as ModelTransportKindValue } from "@mycode/contracts";

import { resolveAnthropicRequestMetadataUserId } from "./anthropic-request-metadata.js";

import {
  createLinkedAbortController,
  readNextWithStreamIdleTimeout,
  resolveModelStreamIdleTimeoutMs,
} from "./stream-idle-timeout.js";
import { createStreamDiagnostics, isZeroOutputModelCompletion } from "./runner-diagnostics.js";
import { canRetryEmptyCompletion } from "./empty-completion-retry.js";
import { createStreamTextOptions } from "./runner-options.js";
import { isDevelopmentModelIOEnv, shouldRecordModelIO } from "./runner-debug.js";
import { sanitizeModelNetworkHeaders } from "./runner-network-headers.js";

import { retryAttemptLoopContinues, retryBudgetMaxAttempts } from "./retry-budget.js";

import {
  createAttemptStatusContext,
  createStatusContext,
  publishModelStatus,
  publishModelTelemetryMilestone,
} from "./runner-status.js";
import { StreamingToolCallAssembler } from "./streaming-tool-call-assembler.js";

import type { AiSdkStreamTextResult } from "./runner-runtime.js";
import { resolveModelForAttempt } from "./runner-runtime-headers.js";

import { repairReasoningHistoryAfterSignatureRejection } from "./reasoning-history-normalization.js";
import { statusPublishOptions } from "./runner-stream-stream-failure-phase.js";
import { handleStreamChunk } from "./runner-stream-handle-stream-chunk.js";
import {
  compactDirectToolCallCommitEvent,
  observeVisibleStreamEvent,
} from "./runner-stream-close-stream-iterator-best-effort.js";
import { applyStreamEventsToRetryBoundary } from "./runner-stream-apply-stream-events-to-retry-boundary.js";

export async function* runStreamText(input: StreamRunInput): AsyncGenerator<ModelStreamEvent> {
  // 重试预算档位：只放宽瞬态失败的放弃条件；
  // `emittedRetryBoundaryEvent` 之后不重试的规则不变。状态事件 maxAttempts 以 0 表示无上限。
  const retryBudget = input.request.modelRetryBudget;
  const statusMaxAttempts = (extraAttempts: number): number =>
    retryBudgetMaxAttempts(retryBudget, input.retry.maxAttempts + extraAttempts);
  const baseStatusContext = createStatusContext({
    maxAttempts: statusMaxAttempts(0),
    request: input.request,
    resolved: input.resolved,
    transport: ModelTransportKindValue.Sse,
  });
  const recordModelIO = shouldRecordModelIO(input.env);
  const isDev = isDevelopmentModelIOEnv(input.env);
  let requestMessages = input.request.messages;
  let signatureRepairAttempted = false;
  let emptyCompletionRetryCount = 0;

  for (
    let attempt = 1;
    retryAttemptLoopContinues(
      retryBudget,
      attempt,
      input.retry.maxAttempts + Number(signatureRepairAttempted),
    );
    attempt += 1
  ) {
    const retryBudgetAttempt = attempt - Number(signatureRepairAttempted);
    const startedAt = Date.now();
    // SSE idle timeout 后的重试如果仍固定首请求窗口，容易被同一段 provider 静默窗口反复打断；
    // core recovery 和 adapter 内部 retry 都统一按重试次数每次增加 30s。
    const streamIdleTimeoutMs = resolveModelStreamIdleTimeoutMs({
      baseTimeoutMs: input.streamIdleTimeoutMs,
      retryNumber: (input.request.streamIdleTimeoutRetryNumber ?? 0) + retryBudgetAttempt - 1,
    });
    let emittedEvent = false;
    let emittedRetryBoundaryEvent = false;
    let emittedError = false;
    let retryScheduledFromStreamChunk = false;
    let offPeakQueueHoldFromStreamChunk = false;
    const pendingRetrySafeEvents: ModelStreamEvent[] = [];
    const diagnostics = createStreamDiagnostics();
    const attemptAbortController = createLinkedAbortController(input.request.abortSignal);
    const attemptRequest = {
      ...input.request,
      abortSignal: attemptAbortController.signal,
      messages: requestMessages,
    };
    const outcome: StreamAttemptOutcome = {
      statusContext: createAttemptStatusContext(
        {
          ...baseStatusContext,
          maxAttempts: statusMaxAttempts(Number(signatureRepairAttempted)),
        },
        attempt,
      ),
      attemptFailed: false,
      awaitIteratorClose: false,
      terminalStatusPublished: false,
    };
    const toolCallAssembler = new StreamingToolCallAssembler({ logger: input.logger });
    let streamIterator: AsyncIterator<TextStreamPart<ToolSet>> | undefined;
    let streamReachedNaturalEnd = false;
    // 提升到 try 外,使 catch 分支也能拿到 options/result 记录失败 model-io。
    let options: ReturnType<typeof createStreamTextOptions> | undefined;
    let result: AiSdkStreamTextResult | undefined;
    let requestHeaders: Record<string, string> = {};
    let requestHeaderCount = 0;
    let resolved = input.resolved;
    let timeToFirstProviderEventMs: number | undefined;
    let timeToFirstContentMs: number | undefined;
    let timeToFirstTextMs: number | undefined;
    let streamMaxIdleMs = 0;
    let streamStallCount = 0;
    let streamOutputCommitted = false;
    const repairThinkingSignatureRejection = (error: unknown): boolean => {
      if (signatureRepairAttempted || resolved.providerKind !== "anthropic") {
        return false;
      }
      const repairedMessages = repairReasoningHistoryAfterSignatureRejection(
        requestMessages,
        error,
      );
      if (!repairedMessages) return false;

      // 签名只对生成它的 thinking block 有效。流尚未提交输出时，只替换
      // 本次请求副本，并给一次不占普通 retry 预算且拥有新 requestId 的物理请求机会；
      // 不能把清理结果写回 canonical history。
      signatureRepairAttempted = true;
      requestMessages = repairedMessages;
      input.logger?.warn("Retrying model stream after thinking signature rejection", {
        attempt,
        event: "model.reasoning_signature_repair.retry",
        maxAttempts: input.retry.maxAttempts + 1,
        nextAttempt: attempt + 1,
        requestId: outcome.statusContext.requestId,
        status: "waiting",
      });
      return true;
    };
    const publishVisibleMilestones = async (observation: {
      contentMs?: number;
      textMs?: number;
    }): Promise<void> => {
      if (timeToFirstContentMs === undefined && observation.contentMs !== undefined) {
        timeToFirstContentMs = observation.contentMs;
        await publishModelTelemetryMilestone(
          {
            ...outcome.statusContext,
            attempt,
            elapsedMs: observation.contentMs,
            timestamp: new Date(startedAt + observation.contentMs).toISOString(),
            type: "model_first_content",
          },
          { logger: input.logger, statusSink: input.statusSink },
        );
      }
      if (timeToFirstTextMs === undefined && observation.textMs !== undefined) {
        timeToFirstTextMs = observation.textMs;
        await publishModelTelemetryMilestone(
          {
            ...outcome.statusContext,
            attempt,
            elapsedMs: observation.textMs,
            timestamp: new Date(startedAt + observation.textMs).toISOString(),
            type: "model_first_text",
          },
          { logger: input.logger, statusSink: input.statusSink },
        );
      }
    };
    const admission = await admitStreamModelAttempt(
      {
        input,
        attempt,
        startedAt,
        resolved,
        requestHeaders,
        requestHeaderCount,
        attemptAbortController,
        streamOutputCommitted,
      },
      outcome,
    );
    const getAttemptContext = (): StreamAttemptPhaseContext => ({
      input,
      attempt,
      startedAt,
      recordModelIO,
      isDev,
      resolved,
      options,
      result,
      requestHeaders,
      requestHeaderCount,
      emittedRetryBoundaryEvent,
      emittedError,
      emittedEvent,
      streamIterator,
      streamReachedNaturalEnd,
      attemptAbortController,
      diagnostics,
      toolCallAssembler,
      attemptRequest,
      statusMaxAttempts,
      retryBudget,
      retryBudgetAttempt,
      repairThinkingSignatureRejection,
      streamOutputCommitted,
      timeToFirstProviderEventMs,
      timeToFirstContentMs,
      timeToFirstTextMs,
      streamMaxIdleMs,
      streamStallCount,
      emptyCompletionRetryCount,
      onEmptyCompletionRetry: () => {
        emptyCompletionRetryCount += 1;
      },
      admission,
    });

    try {
      resolved = await resolveModelForAttempt({
        attempt,
        request: attemptRequest,
        resolveModel: input.resolveModel,
      });
      const anthropicMetadataUserId = await resolveAnthropicRequestMetadataUserId({
        env: input.env,
        providerKind: resolved.providerKind,
        sessionId: outcome.statusContext.sessionId,
      });
      options = createStreamTextOptions({
        anthropicMetadataUserId,
        env: input.env,
        includeModelIO: recordModelIO,
        request: attemptRequest,
        resolved,
        statusContext: outcome.statusContext,
      });
      requestHeaders = sanitizeModelNetworkHeaders(options.headers);
      requestHeaderCount = Object.keys(requestHeaders).length;
      await publishModelStatus(
        {
          ...outcome.statusContext,
          attempt,
          requestHeaderCount,
          requestHeaders,
          timestamp: new Date(startedAt).toISOString(),
          type: "model_request_started",
        },
        statusPublishOptions(input, admission),
      );
      const streamResult = input.runtime.streamText(options);
      result = streamResult;
      streamIterator = streamResult.fullStream[Symbol.asyncIterator]();

      while (true) {
        const next = await readNextWithStreamIdleTimeout(streamIterator, {
          abortController: attemptAbortController.controller,
          onTimeout: async (error) => {
            streamStallCount += 1;
            streamMaxIdleMs = Math.max(streamMaxIdleMs, error.idleMs);
            await publishModelStatus(
              {
                ...outcome.statusContext,
                attempt,
                idleMs: error.idleMs,
                message: error.message,
                requestHeaderCount,
                requestHeaders,
                timeoutMs: error.timeoutMs,
                timestamp: new Date().toISOString(),
                type: "model_stream_stalled",
              },
              statusPublishOptions(input, admission),
            );
          },
          timeoutMs: streamIdleTimeoutMs,
        });
        if (next.done) {
          streamReachedNaturalEnd = true;
          break;
        }
        if (timeToFirstProviderEventMs === undefined) {
          timeToFirstProviderEventMs = Date.now() - startedAt;
          await publishModelTelemetryMilestone(
            {
              ...outcome.statusContext,
              attempt,
              elapsedMs: timeToFirstProviderEventMs,
              timestamp: new Date(startedAt + timeToFirstProviderEventMs).toISOString(),
              type: "model_first_provider_event",
            },
            { logger: input.logger, statusSink: input.statusSink },
          );
        }

        let event: Awaited<ReturnType<typeof handleStreamChunk>>;
        try {
          event = await handleStreamChunk({
            admission,
            attempt,
            chunk: next.value,
            diagnostics,
            emittedRetryBoundaryEvent,
            input,
            pendingRetrySafeEvents,
            requestHeaderCount,
            requestHeaders,
            repairThinkingSignatureRejection,
            retryBudgetAttempt,
            startedAt,
            statusContext: outcome.statusContext,
            toolCallAssembler,
          });
        } catch (error) {
          const directToolCommit = compactDirectToolCallCommitEvent(input.request, next.value);
          if (directToolCommit) {
            // 完整 direct tool-call 已是 provider 事件；name/input 校验即使抛错，
            // 也不能让 adapter 当作首事件前失败再次 SSE 重放。
            emittedRetryBoundaryEvent = true;
            for (const pendingEvent of pendingRetrySafeEvents.splice(0)) {
              emittedEvent = true;
              yield pendingEvent;
            }
            // 无 raw message-block provenance 的 provider 可能直接给完整 tool-call。
            // 先把 inferred block stop 交给隐藏 collector，再传播校验错误，避免 HTTP 重放。
            emittedEvent = true;
            yield directToolCommit;
          }
          throw error;
        }
        const shouldHoldEmptyCompletionEvents =
          !event.emittedError &&
          event.visibleEvents.some((visibleEvent) => visibleEvent.type === "finish") &&
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
          });
        if (shouldHoldEmptyCompletionEvents) {
          // finish 会把已缓存的 start 一并刷给 core；先暂存到自然 EOF，确认这是
          // generic empty 后再重试，避免第一次 attempt 的 finish/start 泄漏到 UI。
          event.visibleEvents.length = 0;
        }
        emittedError = emittedError || event.emittedError;
        emittedEvent = emittedEvent || event.emittedEvent;
        emittedRetryBoundaryEvent = emittedRetryBoundaryEvent || event.emittedRetryBoundaryEvent;

        if (event.retryScheduled) {
          // SSE error chunk 的 retry 是正常控制流，不会进入 catch；
          // 若不显式标记失败，finally 会跳过旧 attempt 的 iterator/tee 清理。
          // 下一次物理请求必须等待本轮 abort 与有界清理后才能启动。
          outcome.attemptFailed = true;
          outcome.awaitIteratorClose = true;
          retryScheduledFromStreamChunk = true;
          offPeakQueueHoldFromStreamChunk = event.offPeakQueueHold;
          break;
        }
        if (event.terminalError) {
          throw event.terminalError;
        }
        if (event.visibleEvents.length > 0) {
          for (const visibleEvent of event.visibleEvents) {
            const observation = observeVisibleStreamEvent(visibleEvent, Date.now() - startedAt);
            await publishVisibleMilestones(observation);
            streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
            yield visibleEvent;
          }
        }
      }

      if (retryScheduledFromStreamChunk) {
        if (offPeakQueueHoldFromStreamChunk) {
          // 排队等待不消耗重试预算：回退计数让 for 自增后原地重试。
          attempt -= 1;
        }
        continue;
      }

      const flushedEvents = applyStreamEventsToRetryBoundary({
        emittedRetryBoundaryEvent,
        events: toolCallAssembler.flush(),
        pendingRetrySafeEvents,
        preserveProviderStreamBoundaries: input.request.preserveProviderStreamBoundaries,
      });
      emittedEvent = emittedEvent || flushedEvents.emittedEvent;
      emittedRetryBoundaryEvent =
        emittedRetryBoundaryEvent || flushedEvents.emittedRetryBoundaryEvent;
      if (flushedEvents.visibleEvents.length > 0) {
        for (const visibleEvent of flushedEvents.visibleEvents) {
          const observation = observeVisibleStreamEvent(visibleEvent, Date.now() - startedAt);
          await publishVisibleMilestones(observation);
          streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
          yield visibleEvent;
        }
      }

      for (const pendingEvent of pendingRetrySafeEvents.splice(0)) {
        emittedEvent = true;
        const observation = observeVisibleStreamEvent(pendingEvent, Date.now() - startedAt);
        await publishVisibleMilestones(observation);
        streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
        yield pendingEvent;
      }
      if (await completeStreamAttempt(getAttemptContext(), outcome, streamResult)) continue;
      return;
    } catch (error) {
      attempt += await recoverStreamAttempt(getAttemptContext(), outcome, error);
    } finally {
      await finalizeStreamAttempt(getAttemptContext(), outcome);
    }
  }
}
