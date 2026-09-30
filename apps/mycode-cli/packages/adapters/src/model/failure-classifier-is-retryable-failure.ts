import {
  ModelErrorCode,
  ModelFailureReason as ModelFailureReasonValue,
  ModelRetryReason as ModelRetryReasonValue,
} from "@mycode/contracts";
import { getApiCallResponseBody, isContextExceededFailure } from "./failure-inspection.js";
import {
  isProviderBusinessError,
  readProviderBusinessFailureFromBody,
  ProviderBusinessError,
} from "./model-execution.js";
import {
  getProviderBusinessCodeMapping,
  isRetryableProviderBusinessNetworkFailure,
  isRetryableProviderBusinessTimeoutFailure,
} from "./failure-provider-business-codes.js";
import {
  type ClassifiedModelFailure,
  providerBusinessMessage,
  resolveProviderBusinessCode,
  resolveProviderBusinessStatusCode,
} from "./failure-classifier-classified-model-failure.js";

export function isRetryableFailure(failure: ClassifiedModelFailure): boolean {
  return failure.retryable && failure.reason !== ModelFailureReasonValue.Cancelled;
}

export function classifyProviderBusinessFailureFromApiCallBody(
  error: unknown,
  statusCode?: number,
  retryAfterMs?: number,
): ClassifiedModelFailure | undefined {
  const body = getApiCallResponseBody(error);
  const detected = readProviderBusinessFailureFromBody(body);
  if (!detected) {
    return undefined;
  }

  return classifyProviderBusinessFailure(
    new ProviderBusinessError({
      providerCode: detected.providerCode,
      providerId: "unknown",
      providerKind: "openai-compatible",
      providerMessage: detected.providerMessage,
      providerRequestId: detected.providerRequestId,
      responseBodySummary: detected.responseBodySummary,
      responseStatus: statusCode ?? detected.statusCode,
      statusCode: statusCode ?? detected.statusCode,
    }),
    statusCode ?? detected.statusCode,
    retryAfterMs,
  );
}

export function classifyProviderBusinessFailure(
  error: unknown,
  statusCode?: number,
  retryAfterMs?: number,
): ClassifiedModelFailure | undefined {
  if (!isProviderBusinessError(error)) {
    return undefined;
  }

  const message = providerBusinessMessage(error);
  const providerCode = resolveProviderBusinessCode(error);
  const effectiveStatusCode = resolveProviderBusinessStatusCode(error, statusCode);
  const mappedFailure = providerCode ? getProviderBusinessCodeMapping(providerCode) : undefined;
  if (mappedFailure) {
    return {
      code: mappedFailure.code,
      message: mappedFailure.message ?? message,
      reason: mappedFailure.reason,
      retryReason: mappedFailure.retryReason,
      retryable: mappedFailure.retryable,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (isContextExceededFailure(error)) {
    return {
      code: ModelErrorCode.ModelContextExceeded,
      message: "Model request exceeded the provider context window.",
      reason: ModelFailureReasonValue.ContextExceeded,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }
  if (isRetryableProviderBusinessTimeoutFailure(error, providerCode, effectiveStatusCode)) {
    return {
      code: ModelErrorCode.ModelRequestTimeout,
      message,
      reason: ModelFailureReasonValue.Timeout,
      retryReason: ModelRetryReasonValue.Timeout,
      retryable: true,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }
  const retryReason =
    effectiveStatusCode !== undefined && effectiveStatusCode >= 500
      ? ModelRetryReasonValue.ServerError
      : ModelRetryReasonValue.NetworkError;

  if (effectiveStatusCode === 401 || effectiveStatusCode === 403) {
    return {
      code: ModelErrorCode.ProviderNotConfigured,
      message,
      reason: ModelFailureReasonValue.AuthFailed,
      retryReason: ModelRetryReasonValue.AuthRefresh,
      retryable: false,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (effectiveStatusCode === 404) {
    return {
      code: ModelErrorCode.ModelNotFound,
      message,
      reason: ModelFailureReasonValue.InvalidRequest,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (effectiveStatusCode === 400 || effectiveStatusCode === 422) {
    return {
      code: ModelErrorCode.InvalidModelRequest,
      message,
      reason: ModelFailureReasonValue.InvalidRequest,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (effectiveStatusCode === 429) {
    return {
      code: ModelErrorCode.ModelRateLimited,
      message,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: true,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (isRetryableProviderBusinessNetworkFailure(error, providerCode)) {
    return {
      code: ModelErrorCode.ModelRequestFailed,
      message,
      reason: ModelFailureReasonValue.NetworkError,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: true,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  if (effectiveStatusCode !== undefined && effectiveStatusCode >= 500) {
    return {
      code: ModelErrorCode.ModelRequestFailed,
      message,
      reason: ModelFailureReasonValue.ServerError,
      retryReason,
      retryable: true,
      retryAfterMs,
      statusCode: effectiveStatusCode,
    };
  }

  return {
    code: ModelErrorCode.ModelRequestFailed,
    message,
    reason: ModelFailureReasonValue.Unknown,
    retryReason,
    retryable: false,
    retryAfterMs,
    statusCode: effectiveStatusCode,
  };
}
