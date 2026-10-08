import { useCallback, useState } from "react";
import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";
import {
  readConversationSummaryPanelOverride,
  type ConversationSummaryPanelOverride,
} from "@/v4/conversationSummaryPanelState.js";

/** 只有当前 scope 的 UI 显示选择有效，不将它写回会话业务投影。 */
export function useConversationSummarySelection(scopeKey: string) {
  const [selection, setSelection] = useState<ConversationSummaryPanelOverride>({
    scopeKey,
    variant: null,
  });
  const setVariantOverride = useCallback(
    (variant: ChatViewSummaryPanelVariant | null) => setSelection({ scopeKey, variant }),
    [scopeKey],
  );
  return {
    variantOverride: readConversationSummaryPanelOverride(selection, scopeKey),
    setVariantOverride,
  };
}
