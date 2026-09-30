import { ModelFailureReason as ModelFailureReasonValue } from "@mycode/contracts";

import { publishModelStatus } from "./runner-status.js";

import { statusPublishOptions } from "./runner-stream-stream-failure-phase.js";

import { closeStreamIteratorBestEffort } from "./runner-stream-close-stream-iterator-best-effort.js";

import type {
  StreamAttemptOutcome,
  StreamAttemptPhaseContext,
} from "./runner-stream-phase-types.js";
export async function finalizeStreamAttempt(
  context: StreamAttemptPhaseContext,
  outcome: StreamAttemptOutcome,
): Promise<void> {
  const {
    input,
    attempt,
    startedAt,
    result,
    requestHeaders,
    requestHeaderCount,
    emittedError,
    streamIterator,
    streamReachedNaturalEnd,
    attemptAbortController,
    streamOutputCommitted,
    admission,
  } = context;
  if (
    !streamReachedNaturalEnd &&
    (outcome.attemptFailed || input.request.preserveProviderStreamBoundaries === true)
  ) {
    // 普通 stream 的 429 retry 失败若不进入本清理分支，
    // AI SDK fullStream tee 会持有旧 provider 请求，连续重试会让后续物理请求卡在发送前。
    // 失败 attempt 必须无条件中止并释放；普通 consumer 主动提前结束仍保持原语义。
    if (!attemptAbortController.signal.aborted) {
      attemptAbortController.controller.abort(
        new Error("Model stream attempt ended before natural EOF."),
      );
    }
    if (!outcome.attemptFailed && !outcome.terminalStatusPublished && !emittedError) {
      // consumer 侧的校验异常只会触发 AsyncIteratorClose，不会回到上面的 catch；
      // 将已启动的物理请求收口为 cancelled，避免 fallback 前遗留悬空 started 状态。
      const completedAt = Date.now();
      await publishModelStatus(
        {
          ...outcome.statusContext,
          attempt,
          durationMs: completedAt - startedAt,
          message: "Model stream consumer closed before natural EOF.",
          reason: ModelFailureReasonValue.Cancelled,
          requestHeaderCount,
          requestHeaders,
          retryable: false,
          errorCode: "model_request_cancelled",
          errorPhase: "stream",
          exceptionType: "AbortError",
          streamOutputCommitted,
          timestamp: new Date(completedAt).toISOString(),
          type: "model_request_failed",
        },
        statusPublishOptions(input, admission),
      );
    }
    if (outcome.attemptFailed && outcome.awaitIteratorClose) {
      await closeStreamIteratorBestEffort(streamIterator, {
        attempt,
        logger: input.logger,
        result,
      });
    } else {
      void closeStreamIteratorBestEffort(streamIterator, {
        attempt,
        logger: input.logger,
      });
    }
  } else if (attemptAbortController.signal.aborted) {
    // 普通 main 保留既有生命周期：只有 caller/idle 已经 abort 时才 best-effort 关闭 iterator。
    void closeStreamIteratorBestEffort(streamIterator, {
      attempt,
      logger: input.logger,
    });
  }
  attemptAbortController.cleanup();
  // 兜底归还（成功 / 抛出 / 消费者提前 return 都到这里）；正常失败路径已在 sleep 前归还，幂等。
  admission.release();
}
