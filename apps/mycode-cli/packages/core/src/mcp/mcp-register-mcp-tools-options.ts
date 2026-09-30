import {
  modelMessageContentToText,
  MYCODE_MCP_ERROR_PRESENTATION_MESSAGE_ONLY,
  MYCODE_MCP_ERROR_PRESENTATION_META_KEY,
  type JsonSchema,
  type McpToolCallResult,
  type McpToolDescriptor,
  type ModelMessageContent,
  type ModelMessageContentBlock,
  type PermissionCapabilityGroup,
} from "@mycode/contracts";
import { MYCODE_CUA_OFFICIAL_MCP_NAMESPACE_NAME as MYCODE_CUA_OFFICIAL_MCP_SERVER_NAME } from "@mycode/shared";
import { asDataUrl, base64PayloadFromMcpImageData } from "./image-normalization.js";
import { toMcpToolName, toModelVisibleMcpNamePart } from "./name.js";

export const MCP_TOOL_TIMEOUT_MS = 30_000;

export const OFFICIAL_CUA_PERMISSION_CAPABILITY_GROUP =
  "official_cua" satisfies PermissionCapabilityGroup;

export const CUA_USER_TITLE_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  description:
    "Required short user-facing title in the user's language that describes why the app interface is being read without implementation terms such as CUA, MCP, or get_app_state",
} satisfies JsonSchema;

export const MYCODE_CUA_CANONICAL_MODEL_PREFIX = "mcp__computer-use__";

export const MYCODE_CUA_PROVIDER_SPELLING_ALIAS_PREFIX = "mcp__computer_use__";

export interface RegisterMcpToolsOptions {
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  /**
   * 由 runtime 使用不可伪造的 product authority 凭据验明的官方 CUA server。
   * 名称本身不构成信任；省略时 fail-closed，所有 MCP 都按普通工具处理，
   * 不投影官方 CUA 规范名，也不挂载 provider 拼写别名。
   */
  officialCuaServerNames?: ReadonlySet<string>;
}

export function toRegisteredMcpToolName(
  descriptor: McpToolDescriptor,
  officialCuaAuthorityVerified: boolean,
): string {
  if (
    officialCuaAuthorityVerified &&
    descriptor.serverName === MYCODE_CUA_OFFICIAL_MCP_SERVER_NAME
  ) {
    // adapter 会把官方插件 serverName 命名空间化，descriptor.name 因而是
    // mcp__plugin_mycode-cua_computer-use__*；直接沿用它会让 provider 约定的 computer-use
    // 工具永远不存在。可信门成立后仅投影模型可见名称，handler 仍用 descriptor 的原路由。
    return `${MYCODE_CUA_CANONICAL_MODEL_PREFIX}${toModelVisibleMcpNamePart(descriptor.toolName)}`;
  }
  return toMcpToolName(descriptor);
}

export function officialCuaProviderSpellingAliases(
  name: string,
  descriptor: McpToolDescriptor,
  officialCuaAuthorityVerified: boolean,
): readonly string[] | undefined {
  if (
    !officialCuaAuthorityVerified ||
    descriptor.serverName !== MYCODE_CUA_OFFICIAL_MCP_SERVER_NAME ||
    !name.startsWith(MYCODE_CUA_CANONICAL_MODEL_PREFIX)
  ) {
    return undefined;
  }
  const toolName = name.slice(MYCODE_CUA_CANONICAL_MODEL_PREFIX.length);
  return toolName.length > 0
    ? [`${MYCODE_CUA_PROVIDER_SPELLING_ALIAS_PREFIX}${toolName}`]
    : undefined;
}

export const McpToolOutputJsonSchema = {
  type: "object",
  required: ["content"],
  properties: {
    content: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    structuredContent: {},
    isError: {
      type: "boolean",
    },
    _meta: {
      type: "object",
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} satisfies JsonSchema;

export function normalizeInputSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || typeof schema !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }

  return {
    ...schema,
    type: "object",
    properties:
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? schema.properties
        : {},
  };
}

export function createModelFacingMcpInputSchema(
  descriptor: McpToolDescriptor,
  isCuaAppObservation: boolean,
): JsonSchema {
  const schema = normalizeInputSchema(descriptor.inputSchema);
  if (!isCuaAppObservation) return schema;

  const properties = schema.properties as Record<string, unknown>;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];

  // 原因：title 是 MyCode 给用户看的意图摘要，不属于上游 mycode-cua 参数。只在模型 contract
  // 叠加必填字段，runtime dispatch 再剥离，既让模型稳定生成可读标题，也保持上游严格 schema 兼容。
  return {
    ...schema,
    properties: {
      ...properties,
      title: CUA_USER_TITLE_SCHEMA,
    },
    required: [...new Set([...required, "title"])],
  };
}

export function isMyCodeCuaGetAppState(
  descriptor: Pick<McpToolDescriptor, "serverName" | "toolName">,
): boolean {
  if (descriptor.toolName.trim().toLowerCase().replace(/-/g, "_") !== "get_app_state") {
    return false;
  }

  const serverName = descriptor.serverName.trim().toLowerCase().replace(/_/g, "-");
  return (
    descriptor.serverName === MYCODE_CUA_OFFICIAL_MCP_SERVER_NAME ||
    serverName === "mycode-cua" ||
    serverName === "computer-use" ||
    (serverName.includes("mycode-cua") && serverName.includes("computer-use"))
  );
}

export function hasInformativeStructuredContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function formatMcpToolResult(output: unknown): ModelMessageContent {
  if (!isMcpToolCallResult(output)) {
    return stringify(output);
  }

  const blocks = output.content.flatMap(formatContentBlock);
  // 生产 adapter 会保留 structuredContent 的空键；undefined、null、空对象和
  // 空数组都没有模型信息，不能追加伪造的 "Structured content" 块。有内容的错误详情
  // 仍需保留，权限引导依赖这条结构化通道。
  if (hasInformativeStructuredContent(output.structuredContent)) {
    blocks.push({
      type: "text",
      text: `Structured content:\n${stringify(output.structuredContent)}`,
    });
  }

  const content = blocks.length > 0 ? collapseModelBlocks(blocks) : stringify(output);
  if (!output.isError) return content;
  // 展示策略由 MCP result 显式声明；通用 bridge 不应识别具体 server，
  // 也不应通过解析错误字符串来猜测哪些内容属于堆栈。
  const errorPresentation = output._meta?.[MYCODE_MCP_ERROR_PRESENTATION_META_KEY];
  return typeof errorPresentation === "string" &&
    errorPresentation === MYCODE_MCP_ERROR_PRESENTATION_MESSAGE_ONLY
    ? content
    : `MCP tool returned an error:\n${modelMessageContentToText(content)}`;
}

export function formatContentBlock(block: Record<string, unknown>): ModelMessageContentBlock[] {
  if (block.type === "text" && typeof block.text === "string") {
    return block.text.length > 0 ? [{ type: "text", text: block.text }] : [];
  }
  if (block.type === "image") {
    const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
    if (typeof block.data === "string" && typeof block.mimeType === "string") {
      return [
        {
          type: "image",
          mediaType: block.mimeType,
          dataUrl: asDataUrl(block.data, block.mimeType),
          source: {
            id: "mcp-image",
            kind: "inline",
            mimeType: block.mimeType,
            placeholder: "MCP image",
            sizeBytes: estimateBase64Bytes(block.data),
          },
        },
      ];
    }
    return [{ type: "text", text: `[MCP image content omitted: ${mimeType}]` }];
  }
  if (block.type === "audio") {
    const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
    return [{ type: "text", text: `[MCP audio content omitted: ${mimeType}]` }];
  }
  if (block.type === "resource") {
    return [{ type: "text", text: `MCP resource content:\n${stringify(block.resource ?? block)}` }];
  }
  return [{ type: "text", text: stringify(block) }];
}

export function collapseModelBlocks(blocks: ModelMessageContentBlock[]): ModelMessageContent {
  if (blocks.every((block) => block.type === "text")) {
    return blocks.map((block) => (block.type === "text" ? block.text : "")).join("\n\n");
  }
  return blocks;
}

export function estimateBase64Bytes(value: string): number | undefined {
  const data = base64PayloadFromMcpImageData(value);
  if (data.length === 0) return undefined;
  return Math.floor((data.replace(/=+$/, "").length * 3) / 4);
}

export function isMcpToolCallResult(value: unknown): value is McpToolCallResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as McpToolCallResult).content)
  );
}

export function toRecordInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export function toMcpRuntimeArguments(
  input: unknown,
  stripCuaUserTitle: boolean,
): Record<string, unknown> {
  const argumentsRecord = toRecordInput(input);
  if (!stripCuaUserTitle || !("title" in argumentsRecord)) return argumentsRecord;

  const runtimeArguments = { ...argumentsRecord };
  delete runtimeArguments.title;
  return runtimeArguments;
}

export function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
