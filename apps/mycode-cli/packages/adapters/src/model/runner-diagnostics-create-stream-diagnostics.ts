import type { LanguageModelUsage } from "ai";
import type { Logger, ModelUsage } from "@mycode/contracts";
import type { AiSdkGenerateTextResult } from "./runner-runtime.js";
import { normalizeUsage } from "./runner-normalization.js";
import { asRecord, stringProperty } from "./runner-record.js";
import { modelStatusContextToLogContext, type ModelStatusContext } from "./runner-status.js";

export type GenerateTextResultWithMetadata = AiSdkGenerateTextResult & {
  request?: { body?: unknown };
  response?: {
    body?: unknown;
    headers?: Record<string, string>;
    id?: string;
    messages?: unknown[];
    modelId?: string;
    timestamp?: Date;
  };
  steps?: unknown[];
};

export interface StreamDiagnostics {
  chunkCounts: Record<string, number>;
  errorChunkCount: number;
  finishReason?: string;
  lastChunkType?: string;
  lastErrorChunk?: unknown;
  lastFinishChunk?: unknown;
  rawFinishReason?: unknown;
  reasoningDeltaChars: number;
  textDeltaChars: number;
  toolCallCount: number;
  usage?: ModelUsage;
}

export function createStreamDiagnostics(): StreamDiagnostics {
  return {
    chunkCounts: {},
    errorChunkCount: 0,
    reasoningDeltaChars: 0,
    textDeltaChars: 0,
    toolCallCount: 0,
  };
}

export function recordStreamChunkDiagnostic(diagnostics: StreamDiagnostics, chunk: unknown): void {
  const record = asRecord(chunk);
  const chunkType = stringProperty(record, "type") ?? typeof chunk;
  diagnostics.lastChunkType = chunkType;
  diagnostics.chunkCounts[chunkType] = (diagnostics.chunkCounts[chunkType] ?? 0) + 1;

  if (chunkType === "text-delta") {
    diagnostics.textDeltaChars += stringProperty(record, "text")?.length ?? 0;
    return;
  }

  if (chunkType === "reasoning-delta") {
    diagnostics.reasoningDeltaChars += stringProperty(record, "text")?.length ?? 0;
    return;
  }

  if (chunkType === "tool-call") {
    diagnostics.toolCallCount += 1;
    return;
  }

  if (chunkType === "finish") {
    diagnostics.finishReason = stringProperty(record, "finishReason") ?? diagnostics.finishReason;
    diagnostics.rawFinishReason = record.rawFinishReason;
    diagnostics.lastFinishChunk = chunk;
    diagnostics.usage = normalizeUsage(
      (record.totalUsage ?? record.usage) as Partial<LanguageModelUsage> | undefined,
    );
    return;
  }

  if (chunkType === "error") {
    diagnostics.errorChunkCount += 1;
    diagnostics.lastErrorChunk = chunk;
  }
}

export function getGenerateTextResultMetadata(
  result?: AiSdkGenerateTextResult,
): GenerateTextResultWithMetadata | undefined {
  return result as GenerateTextResultWithMetadata | undefined;
}

export function logGenerateTextDiagnostics(input: {
  attempt: number;
  completedAt: number;
  logger?: Logger;
  result: AiSdkGenerateTextResult;
  startedAt: number;
  statusContext: ModelStatusContext;
  toolCallCount: number;
  usage: ModelUsage;
}): void {
  const resultWithMetadata = getGenerateTextResultMetadata(input.result);
  const textLength = input.result.text.length;
  const context = {
    ...modelStatusContextToLogContext(input.statusContext, input.attempt),
    durationMs: input.completedAt - input.startedAt,
    event: "model.sdk.generate.completed",
    finishReason: input.result.finishReason,
    module: "adapters.model",
    providerMetadataKeys: objectKeys(input.result.providerMetadata),
    responseBody: summarizeProviderBody(resultWithMetadata?.response?.body),
    responseId: resultWithMetadata?.response?.id,
    status: "completed" as const,
    textLength,
    toolCallCount: input.toolCallCount,
    usage: summarizeModelUsage(input.usage),
  };

  input.logger?.info("AI SDK generateText resolved", context);
  if (
    isSuspiciousModelCompletion({
      finishReason: input.result.finishReason,
      textLength,
      toolCallCount: input.toolCallCount,
      usage: input.usage,
    })
  ) {
    input.logger?.warn("AI SDK generateText returned an empty non-stop result", {
      ...context,
      event: "model.sdk.generate.suspicious_empty",
    });
  }
}

export function summarizeFinishChunkForDiagnostics(
  chunk: unknown,
): Record<string, unknown> | undefined {
  const record = asRecord(chunk);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const response = asRecord(record.response);
  const providerMetadata = asRecord(record.providerMetadata);
  return {
    chunkKeys: objectKeys(record),
    finishReason: summarizeScalar(record.finishReason),
    rawFinishReason: summarizeScalar(record.rawFinishReason),
    providerMetadataKeys: objectKeys(providerMetadata),
    responseBody: summarizeProviderBody(response?.body ?? record.body),
    responseStatus: summarizeScalar(response?.status),
  };
}

export function summarizeProviderBody(body: unknown): Record<string, unknown> | undefined {
  if (body === undefined) return undefined;
  if (body === null) return { type: "null" };

  if (typeof body === "string") {
    return {
      length: body.length,
      preview: body.slice(0, 500),
      type: "string",
    };
  }

  if (typeof body !== "object") {
    return {
      type: typeof body,
      value: summarizeScalar(body),
    };
  }

  const record = body as Record<string, unknown>;
  return {
    code: summarizeScalar(record.code),
    error: summarizeProviderError(record.error),
    keys: objectKeys(record),
    message: summarizeScalar(record.message),
    msg: summarizeScalar(record.msg),
    status: summarizeScalar(record.status),
    success: typeof record.success === "boolean" ? record.success : undefined,
    type: Array.isArray(body) ? "array" : "object",
  };
}

export function summarizeProviderError(error: unknown): unknown {
  if (error === undefined || error === null || typeof error !== "object") {
    return summarizeScalar(error);
  }

  const record = error as Record<string, unknown>;
  return {
    code: summarizeScalar(record.code),
    keys: objectKeys(record),
    message: summarizeScalar(record.message),
    type: summarizeScalar(record.type),
  };
}

export function summarizeModelUsage(usage?: ModelUsage): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    serverToolUse: usage.serverToolUse,
    totalTokens: usage.totalTokens,
  };
}

export function summarizeScalar(value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
}

export function objectKeys(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.keys(value).slice(0, 20);
}

export function isSuspiciousModelCompletion(input: {
  finishReason?: string;
  textLength: number;
  toolCallCount: number;
  usage?: ModelUsage;
}): boolean {
  return (
    input.textLength === 0 &&
    input.toolCallCount === 0 &&
    isNonStopFinish(input.finishReason) &&
    isZeroUsage(input.usage)
  );
}

export function isNonStopFinish(finishReason?: string): boolean {
  const normalized = finishReason?.trim().toLowerCase();
  return normalized !== "stop" && normalized !== "tool-calls" && normalized !== "tool_calls";
}

export function isZeroUsage(usage?: ModelUsage): boolean {
  if (!usage) return true;
  const serverToolUse =
    (usage.serverToolUse?.webSearchRequests ?? 0) + (usage.serverToolUse?.webFetchRequests ?? 0);
  if (serverToolUse > 0) return false;
  const total =
    usage.totalTokens ??
    (usage.inputTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.cacheReadTokens ?? 0) +
      (usage.cacheWriteTokens ?? 0) +
      (usage.reasoningTokens ?? 0);
  return total === 0;
}
