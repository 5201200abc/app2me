import { extractMarkdownArtifactImageRefs } from "@mycode/shared";
import type { AttachmentRef } from "@mycode/shared/mycode-protocol-v4";
import {
  PROTOCOL_V4_LIMITS,
  MYCODE_ATTACHMENT_FAULT_CODES,
  MyCodeAttachmentFaultError,
} from "@mycode/shared/mycode-protocol-v4";

import { ConversationTopicPublisher } from "./conversation-topic-publisher.js";

import { artifactRefBelongsToSession } from "./v4-gateway-v4-command-not-implemented-error.js";
import type { V4GatewayEngine } from "./v4-gateway-engine.js";
export const gatewayMediaCache = {
  resolveReadableMediaAttachment(
    this: V4GatewayEngine,
    publisher: ConversationTopicPublisher,
    sessionId: string,
    ref: string,
    target?: { rowId: number; entityId: string },
    attachmentIndex?: number,
  ): { attachment: AttachmentRef; messageId?: string; attachmentIndex?: number } | null {
    const isPreviewable = (attachment: AttachmentRef) => {
      const mime = attachment.mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
    };
    const matchesRef = (attachment: AttachmentRef) =>
      attachment.ref === ref || attachment.previewRef === ref;
    if (target && attachmentIndex !== undefined) {
      const row = publisher
        .getSnapshot()
        .rows.window.find(
          (candidate) => candidate.rowId === target.rowId && candidate.entityId === target.entityId,
        );
      if (row?.kind !== "userInput") return null;
      const attachment = row.attachments?.[attachmentIndex];
      if (!attachment || !isPreviewable(attachment) || !matchesRef(attachment)) {
        return null;
      }
      // 热态 renderer 可能还持有 original ref，而 hydrate 后的权威 row 已补
      // previewRef；两者属于同一个 row/index，授权不能因投影时序不同而误判为跨行读取。
      const messageId = publisher.getMessageIdForRow(row.rowId);
      return {
        attachment,
        attachmentIndex,
        ...(messageId ? { messageId } : {}),
      };
    }

    // 旧 renderer 没有 row target，无法按消息定位持久 artifact；一旦
    // previewRef 存在就只能授权该 durable ref，不能重新放行可变的原始路径。
    for (const row of publisher.getSnapshot().rows.window) {
      if (row.kind === "userInput") {
        for (const attachment of row.attachments ?? []) {
          if (!isPreviewable(attachment)) continue;
          if ((attachment.previewRef ?? attachment.ref) === ref) return { attachment };
        }
      }
      if (
        row.kind === "assistantText" &&
        artifactRefBelongsToSession(ref, sessionId) &&
        extractMarkdownArtifactImageRefs(row.text).includes(ref)
      ) {
        // assistant Markdown 可以引用工具产出的 session artifact，
        // 但旧授权只查看 userInput.attachments，导致合法图片到 UI 后被 harden
        // 拦截。仍以当前 session 的权威投影做精确 ref 授权，绝不接受 renderer
        // 自报的任意 artifact/path。Markdown 是模型可控文本，所以 URI authority
        // 还必须与当前请求 session 精确匹配；仅“当前投影里出现过”不能证明它有权
        // 读取另一个 session 的 artifact。
        return {
          attachment: {
            ref,
            fileName: "assistant-image",
            mime: "image/*",
            bytes: 0,
          },
        };
      }
    }
    return null;
  },
  /**
   * 读取附件全部字节（带 TTL/容量缓存）。
   *
   * 注意语义：conversationAttachmentRead 的 offset/limit 是**切片**，不是流式读取——
   * 每个首次请求都会把整个附件物化进内存再切片，后续 chunk 命中同一份缓存。
   * 接入方不要把 chunk 协议当作「按需分段拉取」来规划超大文件；真正的 range 读取
   * 需要 host 侧 readBinaryFile 支持 offset（尚未实现）。
   */
  readAttachmentPayload(
    this: V4GatewayEngine,
    sessionId: string,
    ref: string,
    mime: string,
    messageId?: string,
    attachmentIndex?: number,
    allowGeneric = false,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const now = this.now();
    this.pruneBinaryReadCache(now);
    // 首段标签 `att`：这张表与 dwf 产物字节共用（见 BinaryReadCacheEntry），两个键空间
    // 只能靠一个不可能相等的首段隔离。
    const key = `att\u0000${sessionId}\u0000${messageId ?? "legacy"}\u0000${attachmentIndex ?? -1}\u0000${ref}`;
    const cached = this.binaryReadCache.get(key);
    if (cached) {
      cached.accessedAt = now;
      return cached.payload;
    }

    // 预览读取曾复用上传的 20MiB 总量上限；video 使用已有全局输入上限，
    // image 和上传事务继续保持原边界。
    const maxBytes = allowGeneric
      ? PROTOCOL_V4_LIMITS.attachmentPreviewMaxBytes
      : mime.startsWith("video/")
        ? PROTOCOL_V4_LIMITS.attachmentPreviewMaxBytes
        : PROTOCOL_V4_LIMITS.attachmentMaxBytes;
    const payload = this.host.readSessionAttachment!(sessionId, {
      ref,
      mime,
      maxBytes,
      ...(messageId ? { messageId } : {}),
      ...(attachmentIndex !== undefined ? { attachmentIndex } : {}),
    })
      .then((result) => {
        const resultMime = result.mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (
          !allowGeneric &&
          !resultMime.startsWith("image/") &&
          !resultMime.startsWith("video/") &&
          resultMime !== "application/pdf"
        ) {
          throw new MyCodeAttachmentFaultError(MYCODE_ATTACHMENT_FAULT_CODES.previewNotMedia);
        }
        if (result.bytes.byteLength > maxBytes) {
          throw new MyCodeAttachmentFaultError(MYCODE_ATTACHMENT_FAULT_CODES.previewTooLarge);
        }
        const current = this.binaryReadCache.get(key);
        if (current) {
          current.bytes = result.bytes.byteLength;
          this.binaryReadCacheBytes += result.bytes.byteLength;
          this.pruneBinaryReadCache(this.now());
        }
        return result;
      })
      .catch((error) => {
        this.deleteBinaryReadCacheEntry(key);
        throw error;
      });
    this.binaryReadCache.set(key, { sessionId, accessedAt: now, bytes: null, payload });
    return payload;
  },
  pruneBinaryReadCache(this: V4GatewayEngine, now: number = this.now()): void {
    for (const [key, entry] of this.binaryReadCache) {
      if (now - entry.accessedAt > PROTOCOL_V4_LIMITS.attachmentReadCacheTtlMs) {
        this.deleteBinaryReadCacheEntry(key);
      }
    }
    if (this.binaryReadCacheBytes <= PROTOCOL_V4_LIMITS.attachmentReadCacheMaxBytes) return;
    const oldest = [...this.binaryReadCache.entries()]
      .filter(([, entry]) => entry.bytes !== null)
      .sort((left, right) => left[1].accessedAt - right[1].accessedAt);
    for (const [key] of oldest) {
      this.deleteBinaryReadCacheEntry(key);
      if (this.binaryReadCacheBytes <= PROTOCOL_V4_LIMITS.attachmentReadCacheMaxBytes) break;
    }
  },
  deleteBinaryReadCacheEntry(this: V4GatewayEngine, key: string): void {
    const entry = this.binaryReadCache.get(key);
    if (!entry) return;
    this.binaryReadCache.delete(key);
    this.binaryReadCacheBytes = Math.max(0, this.binaryReadCacheBytes - (entry.bytes ?? 0));
  },
};
export type GatewayMediaCacheMethods = typeof gatewayMediaCache;
