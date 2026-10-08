import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";

const CONVERSATION_DRAFT_CONTENT_WIDTH_CLASS_NAME = "max-w-2xl";
// 正文、工具、资源与输入框共用 760px 居中阅读列。
// 列宽包含两侧内边距，正文不再单独限宽，避免下方资源和输入框越过右边界。
const CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME =
  "w-full max-w-[760px] @min-[640px]/conversation:w-[calc(100%_-_var(--conversation-panel-width,280px)_-_40px)]";
const CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME =
  "w-full max-w-[760px] @min-[864px]/conversation:w-[calc(100%_-_4rem)]";
const CONVERSATION_STATUS_PANEL_INLINE_OFFSET_CLASS_NAME =
  "@min-[640px]/conversation:-translate-x-[calc(var(--conversation-panel-width,280px)_*_0.5_+_10px)]";
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

// 草稿欢迎区与同一个输入 dock 共用的响应式居中容器。
export const CONVERSATION_CENTERED_EMPTY_LAYOUT_CLASS_NAME =
  "flex min-h-full flex-col items-center px-4 before:block before:min-h-[52px] before:w-full before:shrink before:basis-[29dvh] before:content-[''] after:block after:min-h-4 after:w-full after:flex-1 after:content-['']";
