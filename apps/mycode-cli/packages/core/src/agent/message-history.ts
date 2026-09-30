// ============================================================
// Message History - Maintains conversation context across turns
// ============================================================

import { type ModelMessageContent, type Model, type TokenUsageInfo } from "@mycode/contracts";
import { type SystemReminderSource } from "../system-reminder/source.js";
import {
  type MessageHistory,
  type RuntimeMessageEntry,
  type CacheStats,
  type ModelInputMessage,
  cloneEntryInput,
  countContextPrefixMessages,
  type RuntimeMessageMetadata,
  createRuntimeUserEntry,
  systemReminderAttachmentEntry,
  cloneRuntimeMessageEntry,
  type ToolCallInput,
  type ReasoningContentInput,
  cloneReasoningBlock,
  cloneTokenUsageInfo,
} from "./message-history-tool-call-input.js";
import { createRuntimeToolResultEntry } from "./message-history-real-user-runtime-metadata.js";

// ============================================================
// Message History Implementation
// ============================================================

export class MessageHistoryImpl implements MessageHistory {
  private entries: RuntimeMessageEntry[] = [];
  private cacheStats: CacheStats = {
    totalMessages: 0,
    cachedMessages: 0,
    lastCacheHit: false,
  };

  init(systemPromptOrMessages?: string | Array<ModelInputMessage | RuntimeMessageEntry>): void {
    this.entries = [];

    if (typeof systemPromptOrMessages === "string" && systemPromptOrMessages.length > 0) {
      this.entries.push({
        message: {
          role: "system",
          content: systemPromptOrMessages,
        },
      });
    } else if (Array.isArray(systemPromptOrMessages)) {
      this.entries.push(...systemPromptOrMessages.map(cloneEntryInput));
    }

    this.cacheStats = {
      totalMessages: this.entries.length,
      cachedMessages: countContextPrefixMessages(this.entries),
      lastCacheHit: false,
    };
  }

  addUser(content: ModelMessageContent, metadata?: RuntimeMessageMetadata): void {
    this.entries.push(createRuntimeUserEntry(content, metadata));
    this.cacheStats.totalMessages = this.entries.length;
  }

  addAttachment(source: SystemReminderSource, content: string): void {
    this.entries.push(systemReminderAttachmentEntry(source, content));
    this.cacheStats.totalMessages = this.entries.length;
  }

  addEntries(entries: readonly RuntimeMessageEntry[]): void {
    this.entries.push(...entries.map(cloneRuntimeMessageEntry));
    this.cacheStats.totalMessages = this.entries.length;
  }

  addAssistant(
    content: string,
    toolCalls?: ToolCallInput[],
    reasoning?: ReasoningContentInput[],
    model?: Pick<Model, "providerId" | "modelId">,
    tokens?: TokenUsageInfo,
  ): void {
    const reasoningBlocks = reasoning?.map((block) => cloneReasoningBlock(block)) ?? [];
    this.entries.push({
      message: {
        role: "assistant",
        content:
          reasoningBlocks.length > 0
            ? [
                ...reasoningBlocks,
                ...(content.length > 0 ? [{ type: "text" as const, text: content }] : []),
              ]
            : content,
        toolCalls: toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
        ...(model ? { providerId: model.providerId, modelId: model.modelId } : {}),
      },
      ...(tokens ? { tokens: cloneTokenUsageInfo(tokens) } : {}),
    });
    this.cacheStats.totalMessages = this.entries.length;
  }

  addToolResult(
    toolCallId: string,
    toolName: string,
    content: ModelMessageContent,
    success: boolean,
    isError = !success,
  ): void {
    this.entries.push(createRuntimeToolResultEntry(toolCallId, toolName, content, isError));
    this.cacheStats.totalMessages = this.entries.length;
  }

  borrowReadOnlyRuntimeEntries(): readonly RuntimeMessageEntry[] {
    return this.entries;
  }

  toRuntimeEntries(): RuntimeMessageEntry[] {
    return this.entries.map(cloneRuntimeMessageEntry);
  }

  replaceMessages(messages: readonly (ModelInputMessage | RuntimeMessageEntry)[]): void {
    this.entries = messages.map(cloneEntryInput);
    this.cacheStats = {
      totalMessages: this.entries.length,
      cachedMessages: countContextPrefixMessages(this.entries),
      lastCacheHit: false,
    };
  }

  getMessageCount(): number {
    return this.entries.length;
  }

  getCacheStats(): CacheStats {
    return { ...this.cacheStats };
  }

  setCacheHit(tokens?: number): void {
    this.cacheStats.lastCacheHit = true;
    this.cacheStats.cacheReadTokens = tokens;
    // Mark all messages as potentially cached
    this.cacheStats.cachedMessages = this.entries.length;
  }

  setCacheMiss(): void {
    this.cacheStats.lastCacheHit = false;
    this.cacheStats.cacheReadTokens = undefined;
    this.cacheStats.cachedMessages = countContextPrefixMessages(this.entries);
  }

  reset(): void {
    const contextPrefixMessages = this.entries.slice(0, countContextPrefixMessages(this.entries));
    this.entries = contextPrefixMessages.map(cloneRuntimeMessageEntry);
    this.cacheStats = {
      totalMessages: contextPrefixMessages.length,
      cachedMessages: contextPrefixMessages.length,
      lastCacheHit: false,
    };
  }
}

// ============================================================
// Factory
// ============================================================

export function createMessageHistory(): MessageHistory {
  return new MessageHistoryImpl();
}

export type { ToolCallInput } from "./message-history-tool-call-input.js";
export type { ReasoningContentInput } from "./message-history-tool-call-input.js";
export type { ModelInputMessage } from "./message-history-tool-call-input.js";
export type { RuntimeMessageSource } from "./message-history-tool-call-input.js";
export type { RuntimeMessageMetadata } from "./message-history-tool-call-input.js";
export type { RuntimeMessageMessageEntry } from "./message-history-tool-call-input.js";
export type { RuntimeAttachmentEntry } from "./message-history-tool-call-input.js";
export type { RuntimeMessageEntry } from "./message-history-tool-call-input.js";
export type { CacheStats } from "./message-history-tool-call-input.js";
export type { MessageHistory } from "./message-history-tool-call-input.js";
export { countContextPrefixMessages } from "./message-history-tool-call-input.js";
export { systemReminderRuntimeMetadata } from "./message-history-tool-call-input.js";
export { realUserRuntimeMetadata } from "./message-history-real-user-runtime-metadata.js";
export { legacySyntheticRuntimeMetadata } from "./message-history-real-user-runtime-metadata.js";
export { todoReminderRuntimeMetadata } from "./message-history-real-user-runtime-metadata.js";
export { systemReminderAttachmentEntry } from "./message-history-tool-call-input.js";
export { createRuntimeUserEntry } from "./message-history-tool-call-input.js";
export { createRuntimeAssistantEntry } from "./message-history-real-user-runtime-metadata.js";
export { createRuntimeToolResultEntry } from "./message-history-real-user-runtime-metadata.js";
export { isKnownSystemReminderSource } from "./message-history-real-user-runtime-metadata.js";
export { cloneRuntimeMessageEntry } from "./message-history-tool-call-input.js";
export { invalidateRuntimeTokenUsage } from "./message-history-real-user-runtime-metadata.js";
export { isRuntimeAttachmentEntry } from "./message-history-tool-call-input.js";
export { cloneModelInputMessage } from "./message-history-tool-call-input.js";
export { cloneModelMessageContent } from "./message-history-tool-call-input.js";
