import { ModelErrorCode, ModelProtocolError, ModelRetryReason } from "@mycode/contracts";
import { classifyModelFailure, inspectProviderFailure } from "./failure-classifier.js";
import type { ClassifiedModelFailure } from "./failure-classifier.js";
import { getResponseHeaders, unwrapRetryError } from "./failure-inspection.js";
import { offPeakTicketExpiredMessage, resolveOffPeakFailureDecision } from "./offpeak-retry.js";

import { recordGenerateTextDebug } from "./runner-debug.js";

import { sanitizeModelNetworkHeaders } from "./runner-network-headers.js";

import {
  calculateRetryDelay,
  logRetryDelayDecision,
  sleep,
  toAdapterError,
} from "./runner-retry.js";
import { publishModelStatus } from "./runner-status.js";

import { RuntimeHeadersRefreshError } from "./runner-runtime-headers.js";
import { retryAllowedByFailurePolicy } from "./workflow-model-failure-policy.js";
import { modelFailureStatusFields } from "./runner-telemetry.js";
import { repairReasoningHistoryAfterSignatureRejection } from "./reasoning-history-normalization.js";

import { retryBudgetAllows } from "./retry-budget.js";
import {
  statusPublishOptions,
  publishRetryScheduledStatus,
} from "./runner-generate-serialize-structured-output.js";
import type {
  GenerateTextRunnerInput,
  GenerateTextAttemptFailureContext,
  GenerateTextRetryDecision,
} from "./runner-generate-types.js";
export async function handleGenerateTextAttemptFailure(
  input: GenerateTextRunnerInput,
  attemptState: GenerateTextAttemptFailureContext,
  error: unknown,
): Promise<GenerateTextRetryDecision> {
  let { requestMessages, signatureRepairAttempted, statusContext } = attemptState;
  const {
    attempt,
    retryBudgetAttempt,
    attemptRequest,
    startedAt,
    resolved,
    options,
    requestInvocationCompleted,
    requestHeaders,
    requestHeaderCount,
    admission,
    retryBudget,
    statusMaxAttempts,
    recordModelIO,
    isDev,
  } = attemptState;

  // 合并后鉴权解析进入 attempt try；与 stream 一致保留网络前凭据缺失的类型化错误。
  if (error instanceof ModelProtocolError && error.code === ModelErrorCode.ModelRequestAuthMissing)
    throw error;

  const completedAt = Date.now();

  const classified = classifyModelFailure(error, input.request.abortSignal);

  if (error instanceof RuntimeHeadersRefreshError) {
    classified.message = error.message;
    classified.retryable = false;
  }

  // off-peak 特判（仅 idle plan provider，见 offpeak-retry.ts）：排队 429 豁免预算、
  // 3102（兼容旧 3001）以稳定标记落败触发 desktop 侧续跑。
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
        ? { ...classified, retryable: true, retryReason: ModelRetryReason.OffpeakQueued }
        : classified;

  const responseHeaders = sanitizeModelNetworkHeaders(getResponseHeaders(unwrapRetryError(error)));

  const repairedMessages =
    !signatureRepairAttempted && resolved.providerKind === "anthropic"
      ? repairReasoningHistoryAfterSignatureRejection(requestMessages, error)
      : undefined;

  const retryWithRepairedHistory = repairedMessages !== undefined;

  if (repairedMessages) {
    // 签名只对生成它的 thinking block 有效。明确收到签名校验 400 时，
    // 只替换本次请求副本，并给一次不占普通 retry 预算的物理请求机会；不能通过
    // 回退 attempt 复用 requestId，也不能改写 canonical history。
    signatureRepairAttempted = true;
    requestMessages = repairedMessages;
    statusContext = {
      ...statusContext,
      maxAttempts: statusMaxAttempts(1),
    };
  }

  const canRetryWithFailurePolicy =
    offPeak?.kind === "queued"
      ? true
      : retryBudgetAllows(retryBudget, retryBudgetAttempt, input.retry.maxAttempts) &&
        // workflow 流量（无上限预算）读策略表而不是分类器的 retryable；有界预算逐字不变。
        retryAllowedByFailurePolicy(
          failure,
          retryBudget,
          inspectProviderFailure(error).providerErrorCode,
        );

  const canRetry = retryWithRepairedHistory || canRetryWithFailurePolicy;

  if (options) {
    recordGenerateTextDebug({
      modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
      attempt,
      debugDir: input.debugDir,
      error,
      isDev,
      normalizedToolCalls: undefined,
      options,
      recordModelIO,
      request: attemptRequest,
      requestId: statusContext.requestId,
      resolved,
      startedAt,
    });
  }

  await publishModelStatus(
    {
      ...statusContext,
      attempt,
      durationMs: completedAt - startedAt,
      message: failure.message,
      reason: failure.reason,
      requestHeaderCount,
      requestHeaders,
      responseHeaderCount: Object.keys(responseHeaders).length,
      responseHeaders,
      retryable: canRetry,
      statusCode: failure.statusCode,
      ...modelFailureStatusFields(error, failure, options ? "response" : "prepare"),
      timestamp: new Date(completedAt).toISOString(),
      type: "model_request_failed",
    },
    {
      ...statusPublishOptions(input, admission),
      failureError: unwrapRetryError(error),
    },
  );

  if (!canRetry) {
    logRetryDelayDecision({
      attempt,
      canRetry,
      failure,
      logger: input.logger,
      responseHeaders,
      statusContext,
    });
    throw toAdapterError(error, failure, statusContext, attempt, {
      errorPhase: requestInvocationCompleted ? "response" : "prepare",
    });
  }

  if (retryWithRepairedHistory) {
    input.logger?.warn("Retrying model request after thinking signature rejection", {
      attempt,
      event: "model.reasoning_signature_repair.retry",
      maxAttempts: statusContext.maxAttempts,
      nextAttempt: attempt + 1,
      requestId: statusContext.requestId,
      status: "waiting",
    });
    await publishRetryScheduledStatus(
      input,
      statusContext,
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
    return { requestMessages, signatureRepairAttempted, attemptOffset: 0 };
  }

  const delayMs =
    offPeak?.kind === "queued"
      ? offPeak.delayMs
      : calculateRetryDelay(input.retry, retryBudgetAttempt, failure.retryAfterMs);

  logRetryDelayDecision({
    attempt,
    canRetry,
    delayMs,
    failure,
    logger: input.logger,
    responseHeaders,
    statusContext,
  });

  await publishRetryScheduledStatus(
    input,
    statusContext,
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
    const sleepResponseHeaders = sanitizeModelNetworkHeaders(
      getResponseHeaders(unwrapRetryError(sleepError)),
    );
    await publishModelStatus(
      {
        ...statusContext,
        attempt,
        message: sleepFailure.message,
        reason: sleepFailure.reason,
        requestHeaderCount,
        requestHeaders,
        responseHeaderCount: Object.keys(sleepResponseHeaders).length,
        responseHeaders: sleepResponseHeaders,
        retryable: false,
        statusCode: sleepFailure.statusCode,
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
    throw toAdapterError(sleepError, sleepFailure, statusContext, attempt, {
      errorPhase: "connect",
    });
  }

  // 排队等待不消耗重试预算：主循环在归还票据后应用此偏移。
  return {
    requestMessages,
    signatureRepairAttempted,
    attemptOffset: offPeak?.kind === "queued" ? -1 : 0,
  };
}
