import { createPartId } from "../deps.js";
import type { MessageId, ModelToolCall, TraceContext } from "../deps.js";

import type { RuntimeModelTextResult, StreamedToolExecutionResult } from "../types.js";

export type ModelStepToolOptions = {
  assistantCreatedAt: number;
  assistantMessageId: MessageId;
  modelTraceContext: TraceContext;
  result: RuntimeModelTextResult;
  streamedToolResults?: StreamedToolExecutionResult[];
  toolCalls: ModelToolCall[];
};
export type ModelStepToolPart = {
  partID: ReturnType<typeof createPartId>;
  declarationIndex: number;
  input: Record<string, unknown>;
  startedAt: number;
};
