import { type JsonSchema, ModelTransportKind, ModelFailureReason } from "./model-json-schema.js";
import {
  modelInputMessageJsonSchema,
  modelSelectionJsonSchema,
} from "./model-create-model-usage-summary.js";

export const modelToolChoiceJsonSchema = {
  oneOf: [
    { enum: ["auto", "none", "required"] },
    {
      type: "object",
      required: ["type", "toolName"],
      additionalProperties: false,
      properties: {
        type: { enum: ["tool"] },
        toolName: { type: "string", minLength: 1 },
      },
    },
  ],
} satisfies JsonSchema;

export const modelTextRequestJsonSchema = {
  type: "object",
  required: ["messages"],
  additionalProperties: false,
  properties: {
    messages: { type: "array", items: modelInputMessageJsonSchema },
    tools: { type: "array" },
    toolChoice: modelToolChoiceJsonSchema,
    temperature: { type: "number" },
    maxOutputTokens: { type: "number" },
    topP: { type: "number" },
    topK: { type: "number" },
    presencePenalty: { type: "number" },
    frequencyPenalty: { type: "number" },
    stopSequences: { type: "array", items: { type: "string" } },
    seed: { type: "number" },
    responseJsonSchema: { type: "object" },
    providerOptions: { type: "object" },
    metadata: { type: "object" },
  },
} satisfies JsonSchema;

export const modelNetworkStatusEventJsonSchema = {
  type: "object",
  required: [
    "type",
    "timestamp",
    "traceId",
    "requestId",
    "model",
    "transport",
    "attempt",
    "maxAttempts",
  ],
  additionalProperties: true,
  properties: {
    type: {
      enum: [
        "model_request_started",
        "model_request_completed",
        "model_request_failed",
        "model_retry_scheduled",
        "model_stream_stalled",
      ],
    },
    timestamp: { type: "string", minLength: 1 },
    traceId: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    turnId: { type: "string", minLength: 1 },
    querySource: { type: "string", minLength: 1 },
    requestId: { type: "string", minLength: 1 },
    model: modelSelectionJsonSchema,
    transport: { enum: Object.values(ModelTransportKind) },
    attempt: { type: "number", minimum: 1 },
    // 0 = 无上限重试预算，故下界是 0 而不是 1。
    maxAttempts: { type: "number", minimum: 0 },
    delayMs: { type: "number", minimum: 0 },
    durationMs: { type: "number", minimum: 0 },
    idleMs: { type: "number", minimum: 0 },
    nextAttempt: { type: "number", minimum: 1 },
    reason: { enum: Object.values(ModelFailureReason) },
    retryable: { type: "boolean" },
    message: { type: "string" },
    statusCode: { type: "number" },
    requestHeaders: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    responseHeaders: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    requestHeaderCount: { type: "number", minimum: 0 },
    responseHeaderCount: { type: "number", minimum: 0 },
    streamRecovery: {
      type: "object",
      required: ["attemptId", "retryNumber", "maxRetries"],
      additionalProperties: false,
      properties: {
        attemptId: { type: "string", minLength: 1 },
        retryNumber: { type: "number", minimum: 1 },
        maxRetries: { type: "number", minimum: 0 },
        recoveredFromRequestId: { type: "string", minLength: 1 },
        anchorId: { type: "string", minLength: 1 },
      },
    },
    timeoutMs: { type: "number", minimum: 0 },
  },
} satisfies JsonSchema;
