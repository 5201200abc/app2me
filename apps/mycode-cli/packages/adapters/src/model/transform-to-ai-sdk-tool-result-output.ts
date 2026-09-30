import {
  modelMessageContentToText,
  type ModelInputMessage,
  type ModelMessageContent,
  type ModelMessageContentBlock,
} from "@mycode/contracts";
import { toStructuredToolResultText } from "./tool-result-media-projection.js";
import { dataUrlToDataContent, unsupportedInputMediaText } from "./media-transform-policy.js";
import {
  type AiSdkMessageTransformOptions,
  type AiSdkToolResultOutput,
  type AiSdkAssistantTransformOptions,
  type AiSdkAssistantContent,
  type AiSdkAssistantContentPart,
  projectToolNameForProvider,
  contentBlockToAiSdkAssistantParts,
} from "./transform-ai-sdk-message-transform-options.js";

export function toAiSdkToolResultOutput(
  content: ModelMessageContent,
  options: AiSdkMessageTransformOptions,
  isError = false,
  textifyStructuredContent = false,
): AiSdkToolResultOutput {
  if (isError) {
    return { type: "error-text", value: modelMessageContentToText(content) };
  }

  if (typeof content === "string") return { type: "text", value: content };

  if (textifyStructuredContent) {
    return { type: "text", value: toStructuredToolResultText(content, options) };
  }

  if (options.stripMedia) {
    return { type: "text", value: modelMessageContentToText(content) };
  }

  const value = content.flatMap((block) => contentBlockToAiSdkToolResultParts(block, options));
  return value.length > 0
    ? { type: "content", value }
    : { type: "text", value: modelMessageContentToText(content) };
}

export function contentBlockToAiSdkToolResultParts(
  block: ModelMessageContentBlock,
  options: AiSdkMessageTransformOptions,
): Extract<AiSdkToolResultOutput, { type: "content" }>["value"] {
  switch (block.type) {
    case "text":
      return block.text.length > 0 ? [{ type: "text", text: block.text }] : [];

    case "reasoning":
      return [];

    case "image": {
      const unsupportedText = unsupportedInputMediaText(block, options.inputFormat);
      if (unsupportedText) {
        return [
          {
            type: "text",
            text: unsupportedText,
          },
        ];
      }
      const data = dataUrlToDataContent(block.dataUrl);
      if (!data) {
        return [
          { type: "text", text: "ERROR: Image file is empty or corrupted. Inform the user." },
        ];
      }
      return [{ type: "image-data", data: data.data, mediaType: block.mediaType }];
    }

    case "video": {
      const unsupportedText = unsupportedInputMediaText(block, options.inputFormat);
      if (unsupportedText) {
        return [
          {
            type: "text",
            text: unsupportedText,
          },
        ];
      }
      // AI SDK tool result part 无 video 变体：视频媒体统一由 tool-result-media-projection
      // 拆成后置 user part（toolResultHasVideoMedia 对含 video 的 tool result 在所有
      // provider kind 上强制 textify），这里不产出内嵌 part。
      return [];
    }

    case "file": {
      if (block.text !== undefined && block.text.length > 0) {
        return [{ type: "text", text: block.text }];
      }
      const unsupportedText = unsupportedInputMediaText(block, options.inputFormat);
      if (unsupportedText) {
        return [
          {
            type: "text",
            text: unsupportedText,
          },
        ];
      }
      const data = block.dataUrl ? dataUrlToDataContent(block.dataUrl) : undefined;
      if (data) {
        return [
          {
            type: "file-data",
            data: data.data,
            mediaType: block.mediaType,
            ...(block.name ? { filename: block.name } : {}),
          },
        ];
      }
      return [{ type: "text", text: modelMessageContentToText([block]) }];
    }

    case "resource_link":
      return [{ type: "text", text: modelMessageContentToText([block]) }];
  }
}

export function toAiSdkAssistantContent(
  content: ModelMessageContent,
  toolCalls: ModelInputMessage["toolCalls"],
  options: AiSdkAssistantTransformOptions,
): AiSdkAssistantContent {
  const toolCallParts =
    toolCalls?.map(
      (toolCall): AiSdkAssistantContentPart => ({
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: projectToolNameForProvider(toolCall.name, options),
        input: toolCall.input,
      }),
    ) ?? [];

  if (typeof content === "string" && toolCallParts.length === 0) {
    return content;
  }

  const contentParts =
    typeof content === "string"
      ? content.length > 0
        ? [{ type: "text" as const, text: content }]
        : []
      : content.flatMap((block) => contentBlockToAiSdkAssistantParts(block, options));

  return [...contentParts, ...toolCallParts];
}
