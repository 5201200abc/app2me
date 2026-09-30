import {
  ModelErrorCode,
  ModelFailureReason as ModelFailureReasonValue,
  ModelProtocolError,
  ModelRetryReason,
} from "@mycode/contracts";
import { classifyModelFailure, type ClassifiedModelFailure } from "./failure-classifier.js";

import { getResponseHeaders, unwrapRetryError } from "./failure-inspection.js";
import { offPeakTicketExpiredMessage, resolveOffPeakFailureDecision } from "./offpeak-retry.js";

import { logStreamFailureDiagnostics } from "./runner-diagnostics.js";

import { recordStreamTextDebug } from "./runner-debug.js";
import { sanitizeModelNetworkHeaders } from "./runner-network-headers.js";

import {
  calculateRetryDelay,
  logRetryDelayDecision,
  sleep,
  TerminalStreamChunkError,
  toAdapterError,
} from "./runner-retry.js";
import { publishModelStatus } from "./runner-status.js";

import { RuntimeHeadersRefreshError } from "./runner-runtime-headers.js";
import { modelFailureStatusFields, readModelFailureErrorPhase } from "./runner-telemetry.js";

import {
  statusPublishOptions,
  resolveStreamFailureDecision,
} from "./runner-stream-stream-failure-phase.js";

import { publishRetryScheduledStatus } from "./runner-stream-apply-stream-events-to-retry-boundary.js";
import type {
  StreamAttemptOutcome,
  StreamAttemptPhaseContext,
} from "./runner-stream-phase-types.js";
export async function recoverStreamAttempt(
  context: StreamAttemptPhaseContext,
  outcome: StreamAttemptOutcome,
  error: unknown,
): Promise<-1 | 0> {
  const {
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
    diagnostics,
    toolCallAssembler,
    attemptRequest,
    statusMaxAttempts,
    retryBudget,
    retryBudgetAttempt,
    repairThinkingSignatureRejection,
    streamOutputCommitted,
    admission,
  } = context;
  outcome.attemptFailed = true;
  if (recordModelIO && options) {
    await recordStreamTextDebug({
      modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
      attempt,
      debugDir: input.debugDir,
      error,
      isDev,
      normalizedToolCalls: toolCallAssembler.snapshotNormalizedToolCalls(),
      options,
      recordModelIO,
      request: attemptRequest,
      requestId: outcome.statusContext.requestId,
      resolved,
      result,
      startedAt,
    });
  }
  if (error instanceof TerminalStreamChunkError) {
    outcome.awaitIteratorClose = true;
    throw error.adapterError;
  }
  if (
    error instanceof ModelProtocolError &&
    error.code === ModelErrorCode.ModelRequestAuthMissing
  ) {
    // stream 在 attempt try 内解析请求鉴权，过去会把网络前的类型化
    // 鉴权缺失错误重新归一化为通用请求失败；generate 则直接保留原始协议错误。
    throw error;
  }
  const completedAt = Date.now();
  const retryWithRepairedHistory =
    !emittedRetryBoundaryEvent && repairThinkingSignatureRejection(error);
  if (retryWithRepairedHistory) {
    outcome.statusContext = {
      ...outcome.statusContext,
      maxAttempts: statusMaxAttempts(1),
    };
  }
  const classified = classifyModelFailure(error, input.request.abortSignal);
  if (error instanceof RuntimeHeadersRefreshError) {
    classified.message = error.message;
    classified.retryable = false;
  }
  // off-peak 特判（仅 idle plan provider）：排队 429 豁免预算无限探测；3102 标记落败触发续跑。
  const offPeak = resolveOffPeakFailureDecision({
    offPeak: resolved.accountAccess?.mode === "off-peak",
    failure: classified,
    error: unwrapRetryError(error),
  });
  const failure: ClassifiedModelFailure =
    offPeak?.kind === "ticketExpired"
      ? {
          ...classified,
          retryable: false,
          message: offPeakTicketExpiredMessage(classified.message),
        }
      : offPeak?.kind === "queued"
        ? {
            ...classified,
            retryable: true,
            retryReason: ModelRetryReason.OffpeakQueued,
          }
        : classified;
  const errorPhase =
    readModelFailureErrorPhase(error) ?? (streamIterator === undefined ? "prepare" : "stream");
  outcome.awaitIteratorClose = failure.reason !== ModelFailureReasonValue.Cancelled;
  const responseHeaders = sanitizeModelNetworkHeaders(getResponseHeaders(unwrapRetryError(error)));
  const failureDecision = resolveStreamFailureDecision({
    attempt: retryBudgetAttempt,
    emittedRetryBoundaryEvent,
    error,
    failure,
    maxAttempts: input.retry.maxAttempts,
    preserveProviderStreamBoundaries: input.request.preserveProviderStreamBoundaries,
    responseHeaders,
    retryBudget,
    streamIteratorCreated: streamIterator !== undefined,
    streamErrorChunkObserved: Boolean(diagnostics.lastErrorChunk || diagnostics.lastFinishChunk),
  });
  // off-peak 排队 429 豁免预算：不消耗 maxAttempts，SSE 可见输出边界仍适用。
  if (offPeak?.kind === "queued" && !emittedRetryBoundaryEvent) {
    failureDecision.canRetry = true;
  }
  if (retryWithRepairedHistory) {
    failureDecision.canRetry = true;
  }
  logStreamFailureDiagnostics({
    attempt,
    canRetry: failureDecision.canRetry,
    diagnostics,
    durationMs: completedAt - startedAt,
    emittedError,
    emittedEvent,
    emittedRetryBoundaryEvent,
    error,
    failure,
    logger: input.logger,
    statusContext: outcome.statusContext,
  });
  await publishModelStatus(
    {
      ...outcome.statusContext,
      attempt,
      durationMs: completedAt - startedAt,
      message: failure.message,
      reason: failure.reason,
      requestHeaderCount,
      requestHeaders,
      responseHeaderCount: Object.keys(responseHeaders).length,
      responseHeaders,
      retryable: failureDecision.canRetry,
      statusCode: failure.statusCode,
      streamOutputCommitted,
      ...modelFailureStatusFields(error, failure, errorPhase),
      timestamp: new Date(completedAt).toISOString(),
      type: "model_request_failed",
    },
    {
      ...statusPublishOptions(input, admission),
      failureError: unwrapRetryError(error),
    },
  );
  outcome.terminalStatusPublished = true;
  if (retryWithRepairedHistory) {
    await publishRetryScheduledStatus(
      input,
      outcome.statusContext,
      attempt,
      0,
      {
        ...failure,
        retryReason: ModelRetryReason.ReasoningSignatureRepair,
      },
      requestHeaders,
      responseHeaders,
      admission,
    );
    return 0;
  }
  if (!failureDecision.canRetry) {
    logRetryDelayDecision({
      attempt,
      canRetry: failureDecision.canRetry,
      failure,
      logger: input.logger,
      responseHeaders,
      statusContext: outcome.statusContext,
    });
    throw toAdapterError(error, failure, outcome.statusContext, attempt, {
      ...failureDecision.context,
      errorPhase,
    });
  }
  const delayMs =
    offPeak?.kind === "queued"
      ? offPeak.delayMs
      : calculateRetryDelay(input.retry, retryBudgetAttempt, failure.retryAfterMs);
  logRetryDelayDecision({
    attempt,
    canRetry: failureDecision.canRetry,
    delayMs,
    failure,
    logger: input.logger,
    responseHeaders,
    statusContext: outcome.statusContext,
  });
  await publishRetryScheduledStatus(
    input,
    outcome.statusContext,
    attempt,
    delayMs,
    failure,
    requestHeaders,
    responseHeaders,
    admission,
  );
  // 退避期间不持票：槽位让给别人，重试再准入。
  admission.release();
  try {
    await sleep(delayMs, input.request.abortSignal);
  } catch (sleepError) {
    const sleepFailure = classifyModelFailure(sleepError, input.request.abortSignal);
    await publishModelStatus(
      {
        ...outcome.statusContext,
        attempt,
        durationMs: Date.now() - startedAt,
        message: sleepFailure.message,
        reason: sleepFailure.reason,
        requestHeaderCount,
        requestHeaders,
        retryable: false,
        statusCode: sleepFailure.statusCode,
        streamOutputCommitted,
        ...modelFailureStatusFields(sleepError, sleepFailure, "connect"),
        timestamp: new Date().toISOString(),
        type: "model_request_failed",
      },
      {
        // 退避期间票据已归还：这次取消不属于任何一次尝试，不转投票据。
        ...statusPublishOptions(input),
        failureError: unwrapRetryError(sleepError),
      },
    );
    outcome.terminalStatusPublished = true;
    throw toAdapterError(sleepError, sleepFailure, outcome.statusContext, attempt, {
      errorPhase: "connect",
    });
  }
  if (offPeak?.kind === "queued") {
    // 排队等待不消耗重试预算：回退计数让 for 自增后原地重试，无限探测。
    return -1;
  }
  return 0;
}
