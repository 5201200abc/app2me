import type { MessageWithParts } from "../deps.js";
import type { StableConversationForkTarget } from "../types.js";
import { stableForkError } from "./session-fork-stable-fork-error.js";

/**
 * stable resolver 已给出目标 product turn 的唯一 segment。core 保留 segment 起点前
 * 的 active transcript 前缀，并要求 ordered ids 在 active branch 中严格连续；不再按
 * parentID 或“同一 assistant turn”向 boundary 后扩张。
 */
export function stableForkHistoryMessages(
  activeMessages: readonly MessageWithParts[],
  target: StableConversationForkTarget,
): MessageWithParts[] {
  if (
    target.orderedMessageIds.length === 0 ||
    target.orderedMessageIds.at(-1) !== target.boundaryMessageId
  ) {
    throw stableForkError("Stable fork target has an invalid boundary", {
      boundaryMessageId: target.boundaryMessageId,
    });
  }
  if (new Set(target.orderedMessageIds).size !== target.orderedMessageIds.length) {
    throw stableForkError("Stable fork target contains duplicate message ids");
  }

  const indexById = new Map(
    activeMessages.map((message, index) => [String(message.info.id), index]),
  );
  const segmentStartIndex = indexById.get(target.orderedMessageIds[0]!);
  if (segmentStartIndex === undefined) {
    throw stableForkError("Stable fork target is not an active transcript segment", {
      messageId: target.orderedMessageIds[0],
    });
  }
  for (const [offset, messageId] of target.orderedMessageIds.entries()) {
    const actual = activeMessages[segmentStartIndex + offset];
    if (String(actual?.info.id) !== messageId) {
      throw stableForkError("Stable fork target is not a contiguous active transcript segment", {
        messageId,
      });
    }
  }
  const selectedSegment = activeMessages.slice(
    segmentStartIndex,
    segmentStartIndex + target.orderedMessageIds.length,
  );
  const boundary = selectedSegment.at(-1);
  if (boundary?.info.role !== "assistant" || boundary.info.error) {
    throw stableForkError("Stable fork boundary is not a completed assistant message", {
      boundaryMessageId: target.boundaryMessageId,
    });
  }
  return [...activeMessages.slice(0, segmentStartIndex), ...selectedSegment];
}
