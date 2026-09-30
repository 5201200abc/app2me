import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";

const CONVERSATION_DRAFT_CONTENT_WIDTH_CLASS_NAME = "max-w-2xl";
const CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME =
  "w-full @min-[640px]/conversation:w-[calc(100%_-_17rem)] @min-[640px]/conversation:max-w-6xl @min-[864px]/conversation:w-[calc(100%_-_22rem)]";
const CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME =
  "w-full @min-[864px]/conversation:w-[calc(100%_-_6rem)] @min-[864px]/conversation:max-w-4xl @min-[1280px]/conversation:w-[calc(100%_-_24rem)] @min-[1280px]/conversation:max-w-6xl";
const CONVERSATION_STATUS_PANEL_INLINE_OFFSET_CLASS_NAME =
  "@min-[640px]/conversation:-translate-x-28";
const CONVERSATION_STATUS_PANEL_AUTO_OFFSET_CLASS_NAME =
  "@min-[1280px]/conversation:-translate-x-36";

type ConversationStatusPanelResolvedVariant = ChatViewSummaryPanelVariant | "auto";

export function getConversationContentWidthClassName(params: {
  centeredEmptyLayout: boolean;
  statusPanelLayout: "none" | "auto" | "inline";
}): string {
  if (params.centeredEmptyLayout) return CONVERSATION_DRAFT_CONTENT_WIDTH_CLASS_NAME;

  // 展开面板在 640px 起位于问答右侧，消息列和输入 dock 共用同一预留宽度。
  return params.statusPanelLayout === "none"
    ? CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME
    : CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME;
}

export function resolveConversationStatusPanelVariant(params: {
  variantOverride: ConversationStatusPanelResolvedVariant | null;
}): ConversationStatusPanelResolvedVariant {
  // 自动模式必须保留到 DOM，由 conversation container query 裁决实际形态；
  // React 不再通过 ResizeObserver 把容器宽度翻译成业务状态。
  return params.variantOverride ?? "auto";
}

export function shouldUseConversationStatusPanelInlineLayout(params: {
  hasContent: boolean;
  variant: ConversationStatusPanelResolvedVariant;
}): boolean {
  return params.hasContent && params.variant !== "mini";
}

export function getConversationStatusPanelOffsetClassName(
  layout: "none" | "auto" | "inline",
): string | undefined {
  if (layout === "inline") return CONVERSATION_STATUS_PANEL_INLINE_OFFSET_CLASS_NAME;
  if (layout === "auto") return CONVERSATION_STATUS_PANEL_AUTO_OFFSET_CLASS_NAME;
  return undefined;
}
