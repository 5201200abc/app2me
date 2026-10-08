import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";

export interface ConversationSummaryPanelOverride {
  scopeKey: string;
  variant: ChatViewSummaryPanelVariant | null;
}

export function readConversationSummaryPanelOverride(
  owner: ConversationSummaryPanelOverride,
  scopeKey: string,
): ChatViewSummaryPanelVariant | null {
  return owner.scopeKey === scopeKey ? owner.variant : null;
}

export function resolveConversationSummaryPanelVariant(
  override: ChatViewSummaryPanelVariant | null,
): ChatViewSummaryPanelVariant {
  // 默认开启只派生显示，不写回手动状态；回答状态变化不能覆盖用户关闭的选择。
  return override ?? "panel";
}
