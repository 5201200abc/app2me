import {
  type RuntimeInputPresentation,
  modelMessageContentToText,
  type ModelCacheControl,
  type ModelMessageContent,
  type ModelMessageContentBlock,
  type Model,
  type ModelReasoningContentBlock,
  type TokenUsageInfo,
} from "@mycode/contracts";
import { type SystemReminderSource } from "../system-reminder/source.js";

// Tool call from model (simple type, no brand)
export interface ToolCallInput {
  id: string;
  name: string;
  input: unknown;
}

export type ReasoningContentInput = ModelReasoningContentBlock;

export interface ModelInputMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ModelMessageContent;
  cacheControl?: ModelCacheControl;
  toolCalls?: ToolCallInput[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  providerId?: Model["providerId"];
  modelId?: Model["modelId"];
}

export type RuntimeMessageSource =
  | SystemReminderSource
  | "shared_context"
  | "real_user"
  | "legacy_synthetic";

export interface RuntimeMessageMetadata {
  source: RuntimeMessageSource;
  inputPresentation?: RuntimeInputPresentation;
}

export interface RuntimeMessageMessageEntry {
  kind?: "message";
  message: ModelInputMessage;
  metadata?: RuntimeMessageMetadata;
  /** 已提交 assistant 自己的 provider tokens；不会发送到 provider。 */
  tokens?: TokenUsageInfo;
  /** 仅在当前 query 内生效；不得进入 canonical history 或 Session persistence。 */
  queryScope?: "output_token_continuation";
}

export interface RuntimeAttachmentEntry {
  kind: "attachment";
  content: string;
  cacheControl?: ModelCacheControl;
  metadata: RuntimeMessageMetadata;
}

export type RuntimeMessageEntry = RuntimeMessageMessageEntry | RuntimeAttachmentEntry;

export interface CacheStats {
  totalMessages: number;
  cachedMessages: number;
  lastCacheHit: boolean;
  cacheReadTokens?: number;
}

// ============================================================
// Message History Interface
// ============================================================

export interface MessageHistory {
  // Initialize with optional system prompt or context prefix messages
  init(systemPromptOrMessages?: string | Array<ModelInputMessage | RuntimeMessageEntry>): void;

  // Add user message
  addUser(content: ModelMessageContent, metadata?: RuntimeMessageMetadata): void;

  // Add structured internal context that provider projection renders at request time.
  addAttachment(source: SystemReminderSource, content: string): void;

  // Add already-built runtime entries while preserving their source metadata.
  addEntries(entries: readonly RuntimeMessageEntry[]): void;

  // Add assistant message (may include tool calls)
  addAssistant(
    content: string,
    toolCalls?: ToolCallInput[],
    reasoning?: ReasoningContentInput[],
    model?: Pick<Model, "providerId" | "modelId">,
    tokens?: TokenUsageInfo,
  ): void;

  // Add tool result
  addToolResult(
    toolCallId: string,
    toolName: string,
    content: ModelMessageContent,
    success: boolean,
    isError?: boolean,
  ): void;

  // 借用当前权威 entries，只允许同步只读；跨异步边界时由调用方做数组浅快照。
  borrowReadOnlyRuntimeEntries(): readonly RuntimeMessageEntry[];

  // 创建可写的防御性副本；Runtime 内部普通只读点应使用 borrowReadOnlyRuntimeEntries。
  toRuntimeEntries(): RuntimeMessageEntry[];

  // Replace the active provider-visible history after compact/rewind.
  replaceMessages(messages: readonly (ModelInputMessage | RuntimeMessageEntry)[]): void;

  // Get current message count
  getMessageCount(): number;

  // Cache management
  getCacheStats(): CacheStats;
  setCacheHit(tokens?: number): void;
  setCacheMiss(): void;

  // Reset for new turn
  reset(): void;
}

export function countContextPrefixMessages(
  messagesOrEntries: readonly (ModelInputMessage | RuntimeMessageEntry)[],
): number {
  let count = 0;
  for (const item of messagesOrEntries) {
    if (isRuntimeAttachmentEntry(item)) {
      if (item.metadata.source === "context_prefix" || item.metadata.source === "skills_listing") {
        count++;
        continue;
      }
      break;
    }
    const message = messageFromEntryInput(item);
    const metadata = metadataFromEntryInput(item);
    if (message.role === "system") {
      count++;
      continue;
    }
    if (message.role !== "user") break;
    if (metadata) {
      if (metadata.source === "context_prefix" || metadata.source === "skills_listing") {
        count++;
        continue;
      }
      break;
    }
    if (isMetaUserContext(message.content)) {
      count++;
      continue;
    }
    break;
  }
  return count;
}

export function isMetaUserContext(content: ModelMessageContent): boolean {
  return modelMessageContentToText(content).trimStart().startsWith("<system-reminder>");
}

export function systemReminderRuntimeMetadata(
  source: SystemReminderSource,
): RuntimeMessageMetadata {
  return { source };
}

export function systemReminderAttachmentEntry(
  source: SystemReminderSource,
  content: string,
): RuntimeAttachmentEntry {
  return {
    kind: "attachment",
    content,
    metadata: systemReminderRuntimeMetadata(source),
  };
}

export function createRuntimeUserEntry(
  content: ModelMessageContent,
  metadata?: RuntimeMessageMetadata,
): RuntimeMessageMessageEntry {
  return {
    message: {
      role: "user",
      content,
    },
    metadata: cloneRuntimeMessageMetadata(metadata),
  };
}

export function cloneEntryInput(
  input: ModelInputMessage | RuntimeMessageEntry,
): RuntimeMessageEntry {
  if (isRuntimeMessageEntry(input)) {
    return cloneRuntimeMessageEntry(input);
  }
  return { message: cloneModelInputMessage(input) };
}

export function cloneRuntimeMessageEntry(entry: RuntimeMessageEntry): RuntimeMessageEntry {
  if (entry.kind === "attachment") {
    return {
      kind: "attachment",
      content: entry.content,
      cacheControl: entry.cacheControl ? { ...entry.cacheControl } : undefined,
      metadata: cloneRuntimeMessageMetadata(entry.metadata)!,
    };
  }
  return {
    message: cloneModelInputMessage(entry.message),
    metadata: cloneRuntimeMessageMetadata(entry.metadata),
    ...(entry.tokens ? { tokens: cloneTokenUsageInfo(entry.tokens) } : {}),
    ...(entry.queryScope ? { queryScope: entry.queryScope } : {}),
  };
}

export function cloneTokenUsageInfo(tokens: TokenUsageInfo): TokenUsageInfo {
  return {
    ...tokens,
    cache: { ...tokens.cache },
  };
}

export function cloneRuntimeMessageMetadata(
  metadata: RuntimeMessageMetadata | undefined,
): RuntimeMessageMetadata | undefined {
  return metadata ? { ...metadata } : undefined;
}

export function messageFromEntryInput(
  input: ModelInputMessage | RuntimeMessageEntry,
): ModelInputMessage {
  if (isRuntimeAttachmentEntry(input)) {
    throw new Error("Runtime attachment entries do not have a direct model message representation");
  }
  return isRuntimeMessageEntry(input) ? input.message : input;
}

export function metadataFromEntryInput(
  input: ModelInputMessage | RuntimeMessageEntry,
): RuntimeMessageMetadata | undefined {
  return isRuntimeMessageEntry(input) ? input.metadata : undefined;
}

export function isRuntimeMessageEntry(
  input: ModelInputMessage | RuntimeMessageEntry,
): input is RuntimeMessageEntry {
  return "message" in input || ("kind" in input && input.kind === "attachment");
}

export function isRuntimeAttachmentEntry(
  input: ModelInputMessage | RuntimeMessageEntry,
): input is RuntimeAttachmentEntry {
  return isRuntimeMessageEntry(input) && "kind" in input && input.kind === "attachment";
}

export function cloneModelInputMessage(message: ModelInputMessage): ModelInputMessage {
  const next: ModelInputMessage = {
    role: message.role,
    content: cloneModelMessageContent(message.content),
  };
  if (message.cacheControl) next.cacheControl = { ...message.cacheControl };
  if (message.toolCalls) next.toolCalls = message.toolCalls.map((toolCall) => ({ ...toolCall }));
  if (message.toolCallId) next.toolCallId = message.toolCallId;
  // 空字符串是可恢复调用的 provider 原始名称，不能在 request-local clone 时按 falsy 丢失。
  if (message.toolName !== undefined) next.toolName = message.toolName;
  if (message.isError !== undefined) next.isError = message.isError;
  if (message.providerId) next.providerId = message.providerId;
  if (message.modelId) next.modelId = message.modelId;
  return next;
}

export function cloneReasoningBlock(block: ReasoningContentInput): ReasoningContentInput {
  return {
    ...block,
    providerOptions: block.providerOptions ? { ...block.providerOptions } : undefined,
  };
}

export function cloneModelMessageContent(content: ModelMessageContent): ModelMessageContent {
  if (typeof content === "string") return content;
  return content.map(cloneModelMessageContentBlock);
}

export function cloneModelMessageContentBlock(
  block: ModelMessageContentBlock,
): ModelMessageContentBlock {
  if (block.type === "reasoning") {
    return cloneReasoningBlock(block);
  }
  if ("source" in block && block.source) {
    return { ...block, source: { ...block.source } };
  }
  return { ...block };
}
