import type { MessagePart, MessageWithParts } from "@mycode/contracts";

/** 冷恢复按 operation 合并持久压缩事实，优先保留带尾部边界的记录。 */
export function indexDurableCompactionParts(messages: readonly MessageWithParts[]) {
  const partsByOperation = new Map<string, Extract<MessagePart, { type: "compaction" }>>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "compaction") continue;
      if (!part.timelineStatus && !part.tail_start_id && !part.compactBoundary) continue;
      const operationId = String(
        part.operationId ?? part.boundaryId ?? `legacy-compact-${String(part.id)}`,
      );
      const existing = partsByOperation.get(operationId);
      if (!existing || (!existing.tail_start_id && part.tail_start_id)) {
        partsByOperation.set(operationId, part);
      }
    }
  }
  return partsByOperation;
}
