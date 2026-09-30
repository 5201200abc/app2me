import type { Logger } from "@mycode/contracts";
import { modelStatusContextToLogContext, type ModelStatusContext } from "./runner-status.js";
import {
  type StreamDiagnostics,
  summarizeScalar,
  summarizeModelUsage,
  isSuspiciousModelCompletion,
} from "./runner-diagnostics-create-stream-diagnostics.js";
import {
  summarizeOutboundModelHeaders,
  summarizeFinishChunkBusinessScan,
} from "./runner-diagnostics-log-stream-failure-diagnostics.js";

export function logStreamDiagnostics(input: {
  attempt: number;
  diagnostics: StreamDiagnostics;
  durationMs: number;
  emittedError: boolean;
  emittedEvent: boolean;
  logger?: Logger;
  outboundHeaders?: Record<string, string>;
  statusContext: ModelStatusContext;
}): void {
  const context = {
    ...modelStatusContextToLogContext(input.statusContext, input.attempt),
    chunkCounts: input.diagnostics.chunkCounts,
    durationMs: input.durationMs,
    emittedError: input.emittedError,
    emittedEvent: input.emittedEvent,
    event: "model.sdk.stream.completed",
    errorChunkCount: input.diagnostics.errorChunkCount,
    finishReason: input.diagnostics.finishReason,
    lastChunkType: input.diagnostics.lastChunkType,
    module: "adapters.model",
    rawFinishReason: summarizeScalar(input.diagnostics.rawFinishReason),
    reasoningDeltaChars: input.diagnostics.reasoningDeltaChars,
    status: "completed" as const,
    textDeltaChars: input.diagnostics.textDeltaChars,
    toolCallCount: input.diagnostics.toolCallCount,
    usage: summarizeModelUsage(input.diagnostics.usage),
  };

  input.logger?.info("AI SDK stream completed", context);
  if (
    isSuspiciousModelCompletion({
      finishReason: input.diagnostics.finishReason,
      textLength: input.diagnostics.textDeltaChars,
      toolCallCount: input.diagnostics.toolCallCount,
      usage: input.diagnostics.usage,
    })
  ) {
    input.logger?.warn("AI SDK stream returned an empty non-stop result", {
      ...context,
      event: "model.sdk.stream.suspicious_empty",
      ...summarizeOutboundModelHeaders(input.outboundHeaders),
      ...summarizeFinishChunkBusinessScan({
        providerId: String(input.statusContext.providerId),
        providerKind: input.statusContext.providerKind,
        diagnostics: input.diagnostics,
      }),
    });
  }
}

export { createStreamDiagnostics } from "./runner-diagnostics-create-stream-diagnostics.js";
export { recordStreamChunkDiagnostic } from "./runner-diagnostics-create-stream-diagnostics.js";
export { getGenerateTextResultMetadata } from "./runner-diagnostics-create-stream-diagnostics.js";
export { logGenerateTextDiagnostics } from "./runner-diagnostics-create-stream-diagnostics.js";
export { logStreamFailureDiagnostics } from "./runner-diagnostics-log-stream-failure-diagnostics.js";
export { logIgnoredStreamChunk } from "./runner-diagnostics-log-stream-failure-diagnostics.js";
export { isSuspiciousStreamDiagnostics } from "./runner-diagnostics-log-stream-failure-diagnostics.js";
export { isZeroOutputModelCompletion } from "./runner-diagnostics-log-stream-failure-diagnostics.js";
