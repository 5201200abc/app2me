import type { TraceContext } from "../tracing/tracer.js";
import type { ModelApiCallObservation } from "../telemetry/index.js";
import {
  type ModelUsage,
  type JsonSchema,
  type ModelStatusSink,
  type ModelRequestSessionType,
  type ModelRetryBudget,
  type ModelRequestAdmission,
  type ModelStreamRecoveryStatus,
} from "./model-json-schema.js";
import {
  type ModelUsageSummary,
  hasModelUsage,
  getModelUsageTotalTokens,
  type ModelInputMessage,
  type ModelToolContract,
  type ModelToolChoice,
  type ModelReasoningContentBlock,
  type ModelToolCall,
} from "./model-model-tool-call.js";

export function createModelUsageSummary(
  usages: readonly ModelUsage[],
): ModelUsageSummary | undefined {
  const realUsages = usages.filter(hasModelUsage);
  if (realUsages.length === 0) return undefined;

  return realUsages.reduce<ModelUsageSummary>(
    (summary, usage) => ({
      source: "provider",
      modelRequestCount: summary.modelRequestCount + 1,
      inputTokens: summary.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: summary.outputTokens + (usage.outputTokens ?? 0),
      totalTokens: summary.totalTokens + getModelUsageTotalTokens(usage),
      cacheReadTokens: summary.cacheReadTokens + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: summary.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
      reasoningTokens: summary.reasoningTokens + (usage.reasoningTokens ?? 0),
      webFetchRequests: summary.webFetchRequests + (usage.serverToolUse?.webFetchRequests ?? 0),
      webSearchRequests: summary.webSearchRequests + (usage.serverToolUse?.webSearchRequests ?? 0),
    }),
    {
      source: "provider",
      modelRequestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      webFetchRequests: 0,
      webSearchRequests: 0,
    },
  );
}

export interface ModelRequestSettings {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
}

export interface ModelTextRequest extends ModelRequestSettings {
  messages: ModelInputMessage[];
  tools?: ModelToolContract[];
  toolChoice?: ModelToolChoice;
  responseJsonSchema?: JsonSchema;
  providerOptions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  /**
   * Runtime-only hook for propagating model transport status to UI/session layers.
   * This is intentionally omitted from the JSON schema below because it is not serializable.
   */
  statusSink?: ModelStatusSink;
  /**
   * Runtime-only trace context. Serialized requests should pass trace ids through metadata.
   */
  traceContext?: TraceContext;
  /** Runtime-only、强类型的模型 API 调用分类；不会进入 Provider 请求。 */
  modelCall?: ModelApiCallObservation;
  /**
   * Runtime-only 的宿主 session 粗分类。Adapter 将它写入受控归因 header；
   * 不允许调用方通过 provider 静态 headers 覆盖。
   */
  modelRequestSessionType?: ModelRequestSessionType;
  /**
   * Runtime-only 重试预算档位（见 {@link ModelRetryBudget}）。与 modelRequestSessionType 同族：
   * 不进 JSON schema、不进 provider 请求。缺省即 `default`。
   */
  modelRetryBudget?: ModelRetryBudget;
  /**
   * Runtime-only 准入端口（见 {@link ModelRequestAdmission}）：在场时 runner 每次尝试先 acquire、
   * 结束即 release。与 statusSink 同族：不进 JSON schema、不进 provider 请求。
   */
  modelRequestAdmission?: ModelRequestAdmission;
  /**
   * Runtime-only SSE idle timeout 递增序号。0/undefined 表示首请求；
   * 每重试一次在 adapter base timeout 上加 30000ms。
   */
  streamIdleTimeoutRetryNumber?: number;
  /** Runtime-only recovery attribution；只进入 status/telemetry，不发送给 Provider。 */
  streamRecovery?: ModelStreamRecoveryStatus;
  /**
   * Runtime-only provider stream 边界开关。compact 隐藏流用它保留首个真实 provider event
   * 与 content block provenance；tool input 提交不受此开关控制，所有请求都等待 AI SDK end。
   */
  preserveProviderStreamBoundaries?: boolean;
}

export interface ModelSource {
  type: "source";
  sourceType: "url" | "document";
  id?: string;
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ModelToolResult {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  providerExecuted?: boolean;
  providerMetadata?: Record<string, unknown>;
}

export interface ModelTextResult {
  text: string;
  finishReason: string;
  usage: ModelUsage;
  reasoning?: ModelReasoningContentBlock[];
  toolCalls?: ModelToolCall[];
  toolResults?: ModelToolResult[];
  sources?: ModelSource[];
  providerMetadata?: Record<string, unknown>;
}

export const modelSelectionJsonSchema = {
  type: "object",
  required: ["providerId", "modelId"],
  additionalProperties: false,
  properties: {
    providerId: { type: "string", minLength: 1 },
    modelId: { type: "string", minLength: 1 },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        reasoningLevel: { type: "string", minLength: 1 },
        maxOutputTokens: { type: "number", minimum: 1 },
      },
    },
  },
} satisfies JsonSchema;

export const attachmentRefJsonSchema = {
  type: "object",
  required: ["id", "kind"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    kind: { enum: ["local_file", "resource", "inline"] },
    uri: { type: "string" },
    path: { type: "string" },
    mimeType: { type: "string" },
    sizeBytes: { type: "number" },
    sha256: { type: "string" },
    placeholder: { type: "string" },
  },
} satisfies JsonSchema;

export const modelMessageContentBlockJsonSchema = {
  oneOf: [
    {
      type: "object",
      required: ["type", "text"],
      additionalProperties: false,
      properties: {
        type: { enum: ["text"] },
        text: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type", "text"],
      additionalProperties: false,
      properties: {
        type: { enum: ["reasoning"] },
        text: { type: "string" },
        providerOptions: { type: "object" },
      },
    },
    {
      type: "object",
      required: ["type", "mediaType", "dataUrl"],
      additionalProperties: false,
      properties: {
        type: { enum: ["image"] },
        mediaType: { type: "string", minLength: 1 },
        dataUrl: { type: "string", minLength: 1 },
        detail: { enum: ["auto", "low", "high", "original"] },
        source: attachmentRefJsonSchema,
      },
    },
    {
      type: "object",
      required: ["type", "mediaType", "dataUrl"],
      additionalProperties: false,
      properties: {
        type: { enum: ["video"] },
        mediaType: { type: "string", minLength: 1 },
        dataUrl: { type: "string", minLength: 1 },
        source: attachmentRefJsonSchema,
      },
    },
    {
      type: "object",
      required: ["type", "mediaType"],
      additionalProperties: false,
      properties: {
        type: { enum: ["file"] },
        mediaType: { type: "string", minLength: 1 },
        name: { type: "string" },
        uri: { type: "string" },
        dataUrl: { type: "string" },
        text: { type: "string" },
        source: attachmentRefJsonSchema,
      },
    },
    {
      type: "object",
      required: ["type", "uri"],
      additionalProperties: false,
      properties: {
        type: { enum: ["resource_link"] },
        uri: { type: "string", minLength: 1 },
        name: { type: "string" },
        title: { type: "string" },
      },
    },
  ],
} satisfies JsonSchema;

export const modelMessageContentJsonSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "array",
      items: modelMessageContentBlockJsonSchema,
    },
  ],
} satisfies JsonSchema;

export const modelInputMessageJsonSchema = {
  type: "object",
  required: ["role", "content"],
  additionalProperties: false,
  properties: {
    role: { enum: ["system", "user", "assistant", "tool"] },
    content: modelMessageContentJsonSchema,
    cacheControl: {
      type: "object",
      required: ["type"],
      additionalProperties: false,
      properties: {
        type: { enum: ["ephemeral"] },
        ttl: { enum: ["5m", "1h"] },
        scope: { enum: ["global", "org"] },
      },
    },
    toolCalls: { type: "array" },
    toolCallId: { type: "string" },
    toolName: { type: "string" },
    isError: { type: "boolean" },
    providerId: { type: "string", minLength: 1 },
    modelId: { type: "string", minLength: 1 },
  },
} satisfies JsonSchema;
