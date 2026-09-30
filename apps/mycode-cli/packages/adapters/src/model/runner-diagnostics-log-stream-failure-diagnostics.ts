import type { Logger, ModelUsage } from "@mycode/contracts";
import { ModelFailureReason as ModelFailureReasonValue } from "@mycode/contracts";
import type { ClassifiedModelFailure } from "./failure-classifier.js";
import { detectProviderBusinessFinishError } from "./provider-finish-business-error.js";
import { asRecord, stringProperty } from "./runner-record.js";
import { modelStatusContextToLogContext, type ModelStatusContext } from "./runner-status.js";
import {
  type StreamDiagnostics,
  summarizeFinishChunkForDiagnostics,
  summarizeScalar,
  summarizeModelUsage,
  objectKeys,
  isSuspiciousModelCompletion,
} from "./runner-diagnostics-create-stream-diagnostics.js";

export function summarizeOutboundModelHeaders(
  headers: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!headers) {
    return { outboundHeaderKeys: [] };
  }

  return { outboundHeaderKeys: Object.keys(headers) };
}

export function summarizeFinishChunkBusinessScan(input: {
  providerId: string;
  providerKind?: string;
  diagnostics: StreamDiagnostics;
}): Record<string, unknown> {
  const finishSource =
    input.diagnostics.lastFinishChunk ??
    ({
      type: "finish",
      finishReason: input.diagnostics.finishReason,
      rawFinishReason: input.diagnostics.rawFinishReason,
    } satisfies Record<string, unknown>);

  const finishBusinessError = detectProviderBusinessFinishError({
    providerId: input.providerId,
    providerKind: input.providerKind,
    source: finishSource,
  });

  return {
    finishBusinessErrorCode: finishBusinessError?.providerCode ?? null,
    finishBusinessErrorMessage: finishBusinessError?.providerMessage ?? null,
    finishChunk: summarizeFinishChunkForDiagnostics(input.diagnostics.lastFinishChunk),
    finishChunkPreview: summarizeRawFinishChunkPreview(input.diagnostics.lastFinishChunk),
    lastErrorChunk: summarizeFinishChunkForDiagnostics(input.diagnostics.lastErrorChunk),
  };
}

export function summarizeRawFinishChunkPreview(
  chunk: unknown,
): Record<string, unknown> | undefined {
  if (chunk === undefined) {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(chunk);
    if (serialized.length <= 2_048) {
      return JSON.parse(serialized) as Record<string, unknown>;
    }
    return {
      truncated: true,
      preview: serialized.slice(0, 2_048),
    };
  } catch {
    return summarizeFinishChunkForDiagnostics(chunk);
  }
}

export function logStreamFailureDiagnostics(input: {
  attempt: number;
  canRetry: boolean;
  diagnostics: StreamDiagnostics;
  durationMs: number;
  emittedError: boolean;
  emittedEvent: boolean;
  emittedRetryBoundaryEvent: boolean;
  error: unknown;
  failure: ClassifiedModelFailure;
  logger?: Logger;
  statusContext: ModelStatusContext;
}): void {
  input.logger?.error("AI SDK stream failed", toLogError(input.error), {
    ...modelStatusContextToLogContext(input.statusContext, input.attempt),
    chunkCounts: input.diagnostics.chunkCounts,
    durationMs: input.durationMs,
    emittedError: input.emittedError,
    emittedEvent: input.emittedEvent,
    emittedRetryBoundaryEvent: input.emittedRetryBoundaryEvent,
    errorAfterFinish: input.diagnostics.finishReason !== undefined,
    errorChunkCount: input.diagnostics.errorChunkCount,
    event: "model.sdk.stream.failed",
    finishReason: input.diagnostics.finishReason,
    lastChunkType: input.diagnostics.lastChunkType,
    module: "adapters.model",
    rawFinishReason: summarizeScalar(input.diagnostics.rawFinishReason),
    reason: input.failure.reason,
    reasoningDeltaChars: input.diagnostics.reasoningDeltaChars,
    retryable: input.canRetry,
    status: input.failure.reason === ModelFailureReasonValue.Cancelled ? "cancelled" : "failed",
    statusCode: input.failure.statusCode,
    statusMessage: input.failure.message,
    textDeltaChars: input.diagnostics.textDeltaChars,
    toolCallCount: input.diagnostics.toolCallCount,
    usage: summarizeModelUsage(input.diagnostics.usage),
  });
}

export function logIgnoredStreamChunk(input: {
  attempt: number;
  chunk: unknown;
  logger?: Logger;
  statusContext: ModelStatusContext;
}): void {
  input.logger?.debug("AI SDK stream chunk was ignored", {
    ...modelStatusContextToLogContext(input.statusContext, input.attempt),
    ...summarizeStreamChunk(input.chunk),
    event: "model.sdk.stream.chunk_ignored",
    module: "adapters.model",
    status: "completed",
  });
}

export function summarizeStreamChunk(chunk: unknown): Record<string, unknown> {
  const record = asRecord(chunk);
  return {
    chunkKeys: objectKeys(record),
    chunkType: stringProperty(record, "type") ?? typeof chunk,
    finishReason: summarizeScalar(record.finishReason),
    rawFinishReason: summarizeScalar(record.rawFinishReason),
  };
}

export function isSuspiciousStreamDiagnostics(diagnostics: StreamDiagnostics): boolean {
  return isSuspiciousModelCompletion({
    finishReason: diagnostics.finishReason,
    textLength: diagnostics.textDeltaChars,
    toolCallCount: diagnostics.toolCallCount,
    usage: diagnostics.usage,
  });
}

export function isZeroOutputModelCompletion(input: {
  finishReason?: string;
  reasoningLength: number;
  textLength: number;
  toolCallCount: number;
  usage?: ModelUsage;
}): boolean {
  return (
    input.finishReason !== undefined &&
    input.reasoningLength === 0 &&
    isSuspiciousModelCompletion({
      finishReason: input.finishReason,
      textLength: input.textLength,
      toolCallCount: input.toolCallCount,
      usage: input.usage,
    })
  );
}

export function toLogError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
