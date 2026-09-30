import {
  type ModelErrorCode as ModelErrorCodeType,
  type ModelFailureReason,
  type ModelRetryReason,
} from "@mycode/contracts";
import { getApiCallResponseBody, unwrapRetryError } from "./failure-inspection.js";
import { readMappedAiSdkProviderBusinessError } from "./failure-ai-sdk-provider-error.js";
import {
  isProviderBusinessError,
  readProviderBusinessFailureFromBody,
  ProviderBusinessError,
} from "./model-execution.js";

export const PROVIDER_BUSINESS_ERROR_WRAPPER_CODE = "PROVIDER_BUSINESS_ERROR";

export interface ClassifiedModelFailure {
  code: ModelErrorCodeType;
  message: string;
  reason: ModelFailureReason;
  retryReason: ModelRetryReason;
  retryable: boolean;
  retryAfterMs?: number;
  statusCode?: number;
}

export interface ProviderFailureDetails {
  providerErrorCode?: string;
  providerErrorMessage?: string;
  providerRequestId?: string;
}

export function inspectProviderFailure(error: unknown): ProviderFailureDetails {
  const unwrapped = unwrapRetryError(error);
  // 分类链路能读取 AI SDK parsed error，但观测链路只认识 ProviderBusinessError，
  // 导致同一次失败在 status event 与最终 error context 中丢失 provider 诊断字段。
  const businessError =
    findProviderBusinessError(unwrapped) ?? readMappedAiSdkProviderBusinessError(unwrapped);
  if (businessError) {
    return {
      providerErrorCode: resolveProviderBusinessCode(businessError),
      providerErrorMessage: providerBusinessMessage(businessError),
      providerRequestId: businessError.providerRequestId,
    };
  }
  const detected = readProviderBusinessFailureFromBody(getApiCallResponseBody(unwrapped));
  return detected
    ? {
        providerErrorCode:
          typeof detected.providerCode === "number"
            ? String(detected.providerCode)
            : detected.providerCode,
        providerErrorMessage: detected.providerMessage,
        providerRequestId: detected.providerRequestId,
      }
    : {};
}

export function findProviderBusinessError(
  error: unknown,
  seen = new WeakSet<object>(),
): ProviderBusinessError | undefined {
  if (isProviderBusinessError(error)) {
    return error;
  }
  if (error === null || typeof error !== "object" || seen.has(error)) {
    return undefined;
  }
  seen.add(error);

  // AI SDK 可能把 fetch 层抛出的 ProviderBusinessError 包在 cause 里；
  // 若只看外层 APICallError，会丢掉 providerCode/message/responseHeaders。
  const cause = (error as { cause?: unknown }).cause;
  return cause && cause !== error ? findProviderBusinessError(cause, seen) : undefined;
}

export function normalizeProviderCode(
  value: ProviderBusinessError["providerCode"],
): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  return normalized.toUpperCase() === PROVIDER_BUSINESS_ERROR_WRAPPER_CODE ? undefined : normalized;
}

export function providerBusinessMessage(error: ProviderBusinessError): string {
  return error.providerMessage ?? error.message ?? "Provider returned a business error.";
}

export function resolveProviderBusinessCode(error: ProviderBusinessError): string | undefined {
  const direct = normalizeProviderCode(error.providerCode);
  if (direct) {
    return direct;
  }

  // ProviderBusinessError 可能被 AI SDK/adapter 二次包装，外层 code 是包装类型，
  // 真实 BigModel 码（如 1234/1261）只保留在 responseBodySummary 的深层结构里。
  return readNestedProviderCode(error.responseBodySummary);
}

export function resolveProviderBusinessStatusCode(
  error: ProviderBusinessError,
  statusCode: number | undefined,
): number | undefined {
  return (
    normalizeHttpFailureStatus(statusCode) ??
    normalizeHttpFailureStatus(error.statusCode) ??
    normalizeHttpFailureStatus(error.responseStatus) ??
    readNestedStatusCode(error.responseBodySummary)
  );
}

export function readNestedProviderCode(value: unknown): string | undefined {
  const records = collectNestedRecords(value);
  const providerCode = firstNormalizedRecordValue(records, "providerCode");
  if (providerCode) return providerCode;

  const errorCode = firstNormalizedRecordValue(records, "error_code");
  if (errorCode) return errorCode;

  const code = firstNormalizedRecordValue(records, "code");
  if (code) return code;

  return firstBracketedProviderCode(records);
}

export function readNestedStatusCode(value: unknown): number | undefined {
  const records = collectNestedRecords(value);
  for (const key of ["statusCode", "status", "responseStatus"] as const) {
    for (const record of records) {
      const statusCode = numberProperty(record, key);
      if (normalizeHttpFailureStatus(statusCode) !== undefined) {
        return statusCode;
      }
    }
  }
  return undefined;
}

export function firstNormalizedRecordValue(
  records: readonly Record<string, unknown>[],
  key: string,
): string | undefined {
  for (const record of records) {
    const code = normalizeProviderCode(record[key] as ProviderBusinessError["providerCode"]);
    if (code) {
      return code;
    }
  }
  return undefined;
}

export function firstBracketedProviderCode(
  records: readonly Record<string, unknown>[],
): string | undefined {
  for (const record of records) {
    const code =
      readBigModelBracketedProviderCode(record.message) ??
      readBigModelBracketedProviderCode(record.providerMessage);
    if (code) {
      return code;
    }
  }
  return undefined;
}

export function collectNestedRecords(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    result.push(record);
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return result;
}

export function numberProperty(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeHttpFailureStatus(value: number | undefined): number | undefined {
  return value !== undefined && value >= 400 && value <= 599 ? value : undefined;
}

export function readBigModelBracketedProviderCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().match(/^\[(\d{4})\](?=\[)/);
  return match?.[1];
}
