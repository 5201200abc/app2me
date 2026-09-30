// ============================================================
// Model Protocol - provider-neutral model contracts
// ============================================================

import { type ModelToolCall } from "./model-model-tool-call.js";
import { type ModelUsage } from "./model-json-schema.js";

export * from "./image-media.js";

export * from "./model.js";

export * from "./invocation-context.js";

export type ModelStreamEvent =
  | {
      type: "start";
    }
  | {
      /**
       * Compact-only replay boundary。Adapter 从 raw provider stream 提炼真实边界；
       * 无 raw provenance 的 direct tool-call 校验失败可补一个 inferred commit。
       * 事件不携带 provider 正文，也不进入 session/UI streaming。
       */
      type: "compact_stream_boundary";
      boundary: "provider_response_start" | "inferred_content_block_stop";
    }
  | {
      type: "compact_stream_boundary";
      boundary: "provider_content_block_start";
      blockType: string | null;
      index: number | null;
    }
  | {
      /** Raw delta 只携带 provenance type，不携带正文。 */
      type: "compact_stream_boundary";
      boundary: "provider_content_block_delta";
      deltaType: string | null;
      index: number | null;
    }
  | {
      type: "compact_stream_boundary";
      boundary: "provider_content_block_stop";
      index: number | null;
    }
  | {
      /** 每个 provider message_delta 覆盖当前 stop reason 状态，后续 null 会清掉先前值。 */
      type: "compact_stream_boundary";
      boundary: "provider_stop_reason";
      present: boolean;
    }
  | {
      type: "text_start";
      id: string;
    }
  | {
      type: "text_delta";
      id?: string;
      text: string;
    }
  | {
      type: "text_end";
      id: string;
    }
  | {
      type: "reasoning_start";
      id: string;
      providerMetadata?: Record<string, unknown>;
    }
  | {
      type: "reasoning_delta";
      id?: string;
      text: string;
      providerMetadata?: Record<string, unknown>;
    }
  | {
      type: "reasoning_end";
      id: string;
      providerMetadata?: Record<string, unknown>;
    }
  | {
      type: "tool_input_start";
      id: string;
      toolName: string;
      providerExecuted?: boolean;
    }
  | {
      type: "tool_input_delta";
      id: string;
      delta: string;
    }
  | {
      type: "tool_input_end";
      id: string;
    }
  | {
      type: "tool_call";
      toolCall: ModelToolCall;
    }
  | {
      type: "finish";
      finishReason: string;
      providerMetadata?: Record<string, unknown>;
      usage: ModelUsage;
    }
  | {
      type: "error";
      error: unknown;
    };

// Re-export for backwards compatibility with code using ToolCall
export type { ModelToolCall as ToolCall };

export * from "./content-protection.js";

export type { JsonSchema } from "./model-json-schema.js";
export type { ModelProviderId } from "./model-json-schema.js";
export type { ModelId } from "./model-json-schema.js";
export { ModelRequestSessionType } from "./model-json-schema.js";
export { ModelRetryBudget } from "./model-json-schema.js";
export type { ModelRequestAdmissionTicket } from "./model-json-schema.js";
export type { ModelRequestAdmission } from "./model-json-schema.js";
export type { ModelRequestTarget } from "./model-json-schema.js";
export { ModelErrorCode } from "./model-json-schema.js";
export { ModelTransportKind } from "./model-json-schema.js";
export { ModelRetryReason } from "./model-json-schema.js";
export { ModelFailureReason } from "./model-json-schema.js";
export type { ModelStreamRecoveryStatus } from "./model-json-schema.js";
export type { ModelRequestStartedStatusEvent } from "./model-json-schema.js";
export type { ModelRequestQueuedStatusEvent } from "./model-json-schema.js";
export type { ModelRequestAdmittedStatusEvent } from "./model-json-schema.js";
export type { ModelRequestCompletedStatusEvent } from "./model-json-schema.js";
export type { ModelRequestFailedStatusEvent } from "./model-json-schema.js";
export type { ModelRetryScheduledStatusEvent } from "./model-json-schema.js";
export type { ModelStreamStalledStatusEvent } from "./model-json-schema.js";
export type { ModelTelemetryMilestoneStatusEvent } from "./model-json-schema.js";
export type { ModelNetworkStatusEvent } from "./model-json-schema.js";
export type { ModelStatusSink } from "./model-json-schema.js";
export { ModelProtocolError } from "./model-json-schema.js";
export { createModelProviderId } from "./model-json-schema.js";
export { createModelId } from "./model-json-schema.js";
export type { ModelMessageRole } from "./model-json-schema.js";
export type { ModelToolCall } from "./model-model-tool-call.js";
export type { AttachmentKind } from "./model-model-tool-call.js";
export type { AttachmentRef } from "./model-model-tool-call.js";
export type { ModelTextContentBlock } from "./model-model-tool-call.js";
export type { ModelReasoningContentBlock } from "./model-model-tool-call.js";
export type { ModelImageContentBlock } from "./model-model-tool-call.js";
export type { ModelFileContentBlock } from "./model-model-tool-call.js";
export type { ModelVideoContentBlock } from "./model-model-tool-call.js";
export type { ModelResourceLinkContentBlock } from "./model-model-tool-call.js";
export type { ModelMessageContentBlock } from "./model-model-tool-call.js";
export type { ModelMessageContent } from "./model-model-tool-call.js";
export type { ModelCacheControl } from "./model-model-tool-call.js";
export type { ModelInputMessage } from "./model-model-tool-call.js";
export { modelMessageContentToText } from "./model-model-tool-call.js";
export { modelMessageContentBlockToText } from "./model-model-tool-call.js";
export type { ModelToolExecutionContext } from "./model-model-tool-call.js";
export type { ModelToolSideEffectScope } from "./model-model-tool-call.js";
export type { ModelToolContract } from "./model-model-tool-call.js";
export type { ModelToolChoice } from "./model-model-tool-call.js";
export type { ModelServerToolUsage } from "./model-json-schema.js";
export type { ModelUsage } from "./model-json-schema.js";
export type { ModelUsageSummary } from "./model-model-tool-call.js";
export { getModelUsageTotalTokens } from "./model-model-tool-call.js";
export { getModelUsageContextTokens } from "./model-model-tool-call.js";
export { getModelUsageInputWindowTokens } from "./model-model-tool-call.js";
export { hasModelUsage } from "./model-model-tool-call.js";
export { createModelUsageSummary } from "./model-create-model-usage-summary.js";
export type { ModelRequestSettings } from "./model-create-model-usage-summary.js";
export type { ModelTextRequest } from "./model-create-model-usage-summary.js";
export type { ModelSource } from "./model-create-model-usage-summary.js";
export type { ModelToolResult } from "./model-create-model-usage-summary.js";
export type { ModelTextResult } from "./model-create-model-usage-summary.js";
export { modelSelectionJsonSchema } from "./model-create-model-usage-summary.js";
export { modelInputMessageJsonSchema } from "./model-create-model-usage-summary.js";
export { modelTextRequestJsonSchema } from "./model-model-text-request-json-schema.js";
export { modelNetworkStatusEventJsonSchema } from "./model-model-text-request-json-schema.js";
