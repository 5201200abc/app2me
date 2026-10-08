import type {
  ConversationRow,
  TurnHeaderRow,
  ToolCallRow,
} from "@mycode/shared/mycode-protocol-v4";
import {
  extractAssistantFileReferences,
  resolveAssistantRawFilePath,
} from "@/lib/assistantFileReferences.js";
import { getPathLeaf, isAbsoluteFilePath } from "@/lib/path.js";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";

import {
  getConversationSourceNameResolver,
  type ConversationSourceNameResolver,
} from "@/v4/conversationSourceNames.js";

export interface ConversationInventoryItem {
  key: string;
  rowId: number;
  label: string;
  kind: "file" | "artifact" | "mcp" | "search" | "web" | "screenshot";
  path?: string;
  originalName?: string;
  ref?: string;
  mime?: string;
  thumbnail?: string;
  count?: number;
  createdAt?: number;
}
export interface ConversationInventoryChange {
  rowId: number;
  summary: NonNullable<TurnHeaderRow["fileChanges"]>;
}
export interface ConversationInventoryModel {
  outputs: ConversationInventoryItem[];
  sources: ConversationInventoryItem[];
  changes: ConversationInventoryChange[];
  webActivity?: { searches: number; pages: number };
}

function stringField(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  for (const key of keys) {
    if (key in input && typeof (input as Record<string, unknown>)[key] === "string") {
      const text = String((input as Record<string, unknown>)[key]).trim();
      if (text) return text;
    }
  }
  return undefined;
}

function webpageSource(row: ToolCallRow): ConversationInventoryItem | undefined {
  const raw = stringField(row.input, ["url", "uri"]);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const title =
      stringField(row.input, ["title", "pageTitle"]) ??
      /^Title:\s*(.+)$/im.exec(row.output?.text ?? "")?.[1];
    return {
      key: `web:${url.href}`,
      kind: "web",
      rowId: row.rowId,
      label: stripDisplayEmoji(title || url.hostname),
      path: url.href,
      createdAt: row.createdAt,
    };
  } catch {
    return undefined;
  }
}

export function buildConversationInventory(
  rows: readonly ConversationRow[],
  workspacePath: string,
  homePath?: string,
  sourceName: ConversationSourceNameResolver = getConversationSourceNameResolver(rows),
): ConversationInventoryModel {
  const outputs = new Map<string, ConversationInventoryItem>();
  const sources = new Map<string, ConversationInventoryItem>();
  const changes: ConversationInventoryChange[] = [];
  const webActivity = { searches: 0, pages: 0 };
  const countedCalls = new Set<string>();
  const addScreenshot = (item: Omit<ConversationInventoryItem, "label" | "kind">) => {
    if (sources.has(item.key)) return;
    sources.set(item.key, { ...item, kind: "screenshot", label: sourceName(item.key) });
  };
  const addFile = (raw: string, rowId: number) => {
    const path = resolveAssistantRawFilePath(workspacePath, raw, { homePath });
    if (path)
      outputs.set(`file:${path}`, {
        key: `file:${path}`,
        rowId,
        label: stripDisplayEmoji(getPathLeaf(path)),
        kind: "file",
        path,
      });
  };
  for (const row of rows) {
    if (row.kind === "artifact") {
      const key = `artifact:${row.logicalArtifactKey}`;
      outputs.set(key, {
        key,
        rowId: row.rowId,
        label: stripDisplayEmoji(row.displayName),
        kind: "artifact",
        ref: row.ref,
      });
    } else if (row.kind === "assistantText") {
      for (const reference of extractAssistantFileReferences(row.text, workspacePath, { homePath }))
        addFile(reference.path, row.rowId);
    } else if (row.kind === "turnHeader" && row.fileChanges?.files) {
      changes.push({ rowId: row.rowId, summary: row.fileChanges });
    } else if (row.kind === "userInput") {
      for (const attachment of row.attachments ?? [])
        addScreenshot({
          key: `attachment:${attachment.ref}`,
          rowId: row.rowId,
          originalName: attachment.fileName,
          ...(isAbsoluteFilePath(attachment.ref) ? { path: attachment.ref } : {}),
          ref: attachment.ref,
          mime: attachment.mime,
          createdAt: row.createdAt,
        });
    } else if (row.kind === "toolCall") {
      const display = row.output?.display ?? row.display;
      const mcp =
        row.display?.kind === "mcp_tool"
          ? row.display
          : display?.kind === "mcp_tool"
            ? display
            : undefined;
      // MCP 调用只留在对话工具行，Sources 保留实际截图、网页和搜索。
      const query = /search/i.test(mcp?.toolName ?? row.toolName)
        ? stringField(row.input, ["query", "search_query", "searchTerm", "q", "pattern"])
        : undefined;
      if (query)
        sources.set(`search:${row.toolCallId}`, {
          key: `search:${row.toolCallId}`,
          rowId: row.rowId,
          kind: "search",
          label: stripDisplayEmoji(query),
          createdAt: row.createdAt,
        });
      // web.run 使用数组参数，旧提取只看扁平 query/url，导致真实搜索和页面漏进 Sources。
      const batch = row.input as
        | { search_query?: { q?: string }[]; open?: { ref_id?: string }[] }
        | undefined;
      if (Array.isArray(batch?.search_query))
        batch.search_query.forEach((entry, index) => {
          if (typeof entry?.q !== "string" || !entry.q.trim()) return;
          sources.set(`search:${row.toolCallId}:${index}`, {
            key: `search:${row.toolCallId}:${index}`,
            rowId: row.rowId,
            kind: "search",
            label: stripDisplayEmoji(entry.q),
            createdAt: row.createdAt,
          });
        });
      if (Array.isArray(batch?.open))
        batch.open.forEach((entry) => {
          const page = webpageSource({ ...row, input: { url: entry?.ref_id } });
          if (page && !sources.has(page.key)) sources.set(page.key, page);
        });
      const webpage = webpageSource(row);
      // 来源网址去重不等于操作次数；只累计成功调用，重复投影不重复计数。
      if (row.status === "success" && !countedCalls.has(row.toolCallId)) {
        countedCalls.add(row.toolCallId);
        webActivity.searches += query ? 1 : 0;
        webActivity.searches += Array.isArray(batch?.search_query)
          ? batch.search_query.filter((entry) => typeof entry?.q === "string" && entry.q.trim())
              .length
          : 0;
        webActivity.pages += Array.isArray(batch?.open)
          ? batch.open.filter((entry) => typeof entry?.ref_id === "string" && entry.ref_id.trim())
              .length
          : webpage
            ? 1
            : 0;
      }
      if (webpage) {
        const previous = sources.get(webpage.key);
        sources.delete(webpage.key);
        sources.set(
          webpage.key,
          previous &&
            previous.label !== new URL(webpage.path!).hostname &&
            webpage.label === new URL(webpage.path!).hostname
            ? { ...webpage, label: previous.label }
            : webpage,
        );
      }
      if (row.display?.kind === "node_repl_images")
        row.display.images?.forEach((image, index) =>
          addScreenshot({
            key: `screenshot:${row.toolCallId}:${index}`,
            rowId: row.rowId,
            thumbnail: `data:${image.mimeType};base64,${image.base64}`,
            mime: image.mimeType,
            createdAt: row.createdAt,
          }),
        );
      if (display?.kind === "cua")
        display.media?.forEach((image, index) => {
          if (image.mimeType.startsWith("image/"))
            addScreenshot({
              key: `screenshot:${row.toolCallId}:${index}`,
              rowId: row.rowId,
              ...(image.data ? { thumbnail: `data:${image.mimeType};base64,${image.data}` } : {}),
              ref: image.artifactUri,
              mime: image.mimeType,
              createdAt: row.createdAt,
            });
        });
      // 失败/取消的写调用不能当作产物；修改计数只来自权威 turnHeader。
      if (row.status !== "success") continue;
      if (display?.kind === "file_diff") addFile(display.filePath, row.rowId);
      else if (/^(Write|Edit|MultiEdit)$/i.test(row.toolName)) {
        const file = stringField(row.input, ["file_path", "filePath"]);
        if (file) addFile(file, row.rowId);
      }
    }
  }
  return { outputs: [...outputs.values()], sources: [...sources.values()], changes, webActivity };
}
