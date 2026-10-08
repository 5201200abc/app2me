import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";
/*
 * Derived from vercel/ai-elements (packages/elements/src/reasoning.tsx).
 * Copyright 2023 Vercel, Inc. Licensed under Apache-2.0.
 * Modified by MyCode: local integration, formatting and adaptations.
 * See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
 */
("use client");

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import { cn } from "../lib/utils.js";
import { TID_CHAT_REASONING_CONTENT, TID_CHAT_REASONING_TRIGGER } from "@mycode/shared";
import "./reasoning.css";
import { ProcessRowContent } from "@/components/ui/process-row.js";
import { LightbulbIcon, ChevronRightIcon } from "@/components/icons/tabler.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import {
  EMPTY_SCROLL_MASK_STATE,
  getVerticalScrollMaskStyle,
  resolveVerticalScrollMaskState,
  type ScrollMetrics,
  type ScrollMaskState,
} from "@/mentions/components/scrollMask.js";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  shouldRenderContent: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  autoCollapseKey?: string | number | null;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number | null;
  startedAt?: number;
};

const MS_IN_S = 1000;
const REASONING_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS = 300;
const REASONING_BOTTOM_LOCK_DISTANCE_PX = 2;

export function shouldAutoCollapseReasoning({
  autoCollapseKey,
  previousAutoCollapseKey,
  userInteracted,
}: {
  autoCollapseKey: string | number | null | undefined;
  previousAutoCollapseKey: string | number | null | undefined;
  userInteracted: boolean;
}) {
  return autoCollapseKey != null && autoCollapseKey !== previousAutoCollapseKey && !userInteracted;
}

export function getReasoningBottomDistance({
  clientHeight,
  scrollHeight,
  scrollTop,
}: ScrollMetrics) {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isReasoningScrollAtBottom(metrics: ScrollMetrics) {
  return getReasoningBottomDistance(metrics) <= REASONING_BOTTOM_LOCK_DISTANCE_PX;
}

export function normalizeReasoningDurationSeconds(duration: number | null | undefined) {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? Math.max(1, Math.floor(duration))
    : undefined;
}

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    autoCollapseKey = null,
    open,
    defaultOpen = false,
    onOpenChange,
    duration: durationProp,
    startedAt,
    children,
    ...props
  }: ReasoningProps) => {
    const isOpenControlled = open !== undefined;
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [measuredDuration, setMeasuredDuration] = useState<number | undefined>();
    const duration = isStreaming
      ? measuredDuration
      : (normalizeReasoningDurationSeconds(durationProp) ?? measuredDuration);

    const startTimeRef = useRef<number | null>(null);
    const contentUnmountDelayRef = useRef<number | null>(null);
    const userInteractedRef = useRef(false);
    const previousAutoCollapseKeyRef = useRef<string | number | null>(null);
    const [shouldRenderContent, setShouldRenderContent] = useState(() => isOpen);
    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        userInteractedRef.current = true;
        if (nextOpen) {
          setShouldRenderContent(true);
        }
        setIsOpen(nextOpen);
      },
      [setIsOpen],
    );

    useEffect(() => {
      if (!isStreaming) {
        if (startTimeRef.current !== null) {
          setMeasuredDuration(
            Math.max(1, Math.floor((Date.now() - startTimeRef.current) / MS_IN_S)),
          );
        }
        startTimeRef.current = null;
        return;
      }

      if (startTimeRef.current === null) {
        startTimeRef.current = startedAt ?? Date.now();
      }
      const updateDuration = () => {
        if (startTimeRef.current === null) return;
        setMeasuredDuration(Math.max(1, Math.floor((Date.now() - startTimeRef.current) / MS_IN_S)));
      };
      // 旧行没有耗时不能按挂载时间估算；仅实时行开启展示计时，收起时也继续更新。
      updateDuration();
      const durationTimer = window.setInterval(updateDuration, MS_IN_S);
      return () => window.clearInterval(durationTimer);
    }, [isStreaming, startedAt]);

    useEffect(() => {
      const previousAutoCollapseKey = previousAutoCollapseKeyRef.current;
      previousAutoCollapseKeyRef.current = autoCollapseKey;

      if (isOpenControlled) {
        return;
      }

      // 输出边界是结束收起的补充信号；用户手动操作后，自动规则不能覆盖选择。
      if (
        shouldAutoCollapseReasoning({
          autoCollapseKey,
          previousAutoCollapseKey,
          userInteracted: userInteractedRef.current,
        })
      ) {
        setIsOpen(false);
      }
    }, [autoCollapseKey, isOpenControlled, setIsOpen]);

    useEffect(() => {
      if (isOpen) {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
          contentUnmountDelayRef.current = null;
        }
        setShouldRenderContent(true);
        return;
      }

      if (!shouldRenderContent) {
        return;
      }

      // 思考内容收起时不能立刻卸载 children。Radix 的高度动画需要
      // closed 阶段仍能读到真实内容高度；先让 300ms 收起动画跑完，再卸载重 DOM。
      contentUnmountDelayRef.current = window.setTimeout(() => {
        setShouldRenderContent(false);
        contentUnmountDelayRef.current = null;
      }, REASONING_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS);

      return () => {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
          contentUnmountDelayRef.current = null;
        }
      };
    }, [isOpen, shouldRenderContent]);

    useEffect(() => {
      return () => {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
        }
      };
    }, []);

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen, shouldRenderContent }),
      [duration, isOpen, isStreaming, setIsOpen, shouldRenderContent],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose flex flex-col", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {typeof children === "string" ? stripDisplayEmoji(children) : children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
  streamingText?: string;
};

export function scrollReasoningSummaryToEnd(
  viewport: Pick<HTMLElement, "scrollLeft" | "scrollWidth">,
) {
  viewport.scrollLeft = viewport.scrollWidth;
}

export function isReasoningSummaryOverflowing({
  clientWidth,
  scrollWidth,
}: Pick<HTMLElement, "clientWidth" | "scrollWidth">) {
  return scrollWidth > clientWidth + 1;
}

export function resolveReasoningStreamingSummary(
  streamingText: string,
): { key: string; text: string } | null {
  const lines = streamingText.replace(/\r\n?/gu, "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = lines[index]?.trim() ?? "";
    if (text.length > 0) {
      return { key: String(index), text };
    }
  }
  return null;
}

const REASONING_SUMMARY_MASK =
  "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)";

export function getReasoningSummaryMaskStyle(isOverflowing: boolean): CSSProperties | undefined {
  if (!isOverflowing) {
    return undefined;
  }
  return {
    WebkitMaskImage: REASONING_SUMMARY_MASK,
    maskImage: REASONING_SUMMARY_MASK,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
  };
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage,
    streamingText: _streamingText,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();
    const { intl } = useMyCodeIntl();
    const seconds = normalizeReasoningDurationSeconds(duration);
    const thinkingMessage = getThinkingMessage?.(isStreaming, seconds) ?? (
      <span className="font-normal text-foreground-subtle" data-reasoning-label="true">
        {intl.formatMessage({
          id: isStreaming ? "chat.reasoning.thinking" : "chat.reasoning.thought",
        })}
      </span>
    );
    return (
      <CollapsibleTrigger
        data-process-row
        data-testid={TID_CHAT_REASONING_TRIGGER}
        data-reasoning-status={isStreaming ? "streaming" : "complete"}
        className={cn(
          "group/reasoning flex h-7 min-h-7 w-full min-w-0 items-center gap-1.5 rounded-lg text-left text-ui-base text-foreground-subtlest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
          className,
        )}
        {...props}
      >
        {children ?? (
          <ProcessRowContent icon={<LightbulbIcon />} iconClassName="reasoning-indicator">
            {thinkingMessage}
            {seconds !== undefined ? (
              <>
                <span
                  data-process-stat
                  className="font-normal text-foreground-subtlest"
                  aria-hidden
                >
                  ·
                </span>
                <span
                  className="whitespace-nowrap font-normal text-foreground-subtlest"
                  data-reasoning-duration="true"
                >
                  {intl.formatMessage(
                    { id: "chat.reasoning.durationSeconds" },
                    { seconds: String(seconds) },
                  )}
                </span>
              </>
            ) : null}
            <ChevronRightIcon
              aria-hidden
              size={16}
              data-process-chevron
              className={cn(
                "size-4 shrink-0 text-foreground-subtlest transition-transform duration-150",
                isOpen ? "rotate-90" : "rotate-0",
              )}
            />
          </ProcessRowContent>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
  variant?: "default" | "nested";
};

export const ReasoningContent = memo(
  ({ className, children, forceMount, variant = "default", ...props }: ReasoningContentProps) => {
    const { isOpen, shouldRenderContent } = useReasoning();
    const shouldRenderChildren = isOpen || shouldRenderContent || Boolean(forceMount);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const autoFollowBottomRef = useRef(true);
    const [scrollMaskState, setScrollMaskState] =
      useState<ScrollMaskState>(EMPTY_SCROLL_MASK_STATE);
    const updateScrollMaskState = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        setScrollMaskState(EMPTY_SCROLL_MASK_STATE);
        return;
      }

      setScrollMaskState(
        resolveVerticalScrollMaskState({
          clientHeight: scrollNode.clientHeight,
          scrollHeight: scrollNode.scrollHeight,
          scrollTop: scrollNode.scrollTop,
        }),
      );
    }, []);
    const scrollToReasoningBottom = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        return;
      }

      scrollNode.scrollTop = scrollNode.scrollHeight;
      updateScrollMaskState();
    }, [updateScrollMaskState]);
    const handleScroll = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        return;
      }

      autoFollowBottomRef.current = isReasoningScrollAtBottom({
        clientHeight: scrollNode.clientHeight,
        scrollHeight: scrollNode.scrollHeight,
        scrollTop: scrollNode.scrollTop,
      });
      updateScrollMaskState();
    }, [updateScrollMaskState]);

    useEffect(() => {
      if (!shouldRenderChildren) {
        autoFollowBottomRef.current = true;
        setScrollMaskState(EMPTY_SCROLL_MASK_STATE);
        return;
      }

      const scrollNode = scrollRef.current;
      if (!scrollNode || typeof ResizeObserver === "undefined") {
        if (autoFollowBottomRef.current) {
          scrollToReasoningBottom();
        } else {
          updateScrollMaskState();
        }
        return;
      }

      // thought 内容流式追加时 scrollHeight 会变化；同时监听容器和内容尺寸。
      // 默认吸底跟随最新思考；用户主动离底后暂停，直到用户自己滚回底部再恢复。
      const syncScrollPosition = () => {
        if (autoFollowBottomRef.current) {
          scrollToReasoningBottom();
          return;
        }
        updateScrollMaskState();
      };
      syncScrollPosition();
      const resizeObserver = new ResizeObserver(syncScrollPosition);
      resizeObserver.observe(scrollNode);
      if (contentRef.current) {
        resizeObserver.observe(contentRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, [scrollToReasoningBottom, shouldRenderChildren, updateScrollMaskState]);

    useEffect(() => {
      if (!shouldRenderChildren) {
        return;
      }
      if (autoFollowBottomRef.current) {
        scrollToReasoningBottom();
        return;
      }
      updateScrollMaskState();
    }, [children, scrollToReasoningBottom, shouldRenderChildren, updateScrollMaskState]);

    const scrollMaskStyle = getVerticalScrollMaskStyle(scrollMaskState);
    const scrollMaskData =
      scrollMaskState.showTop && scrollMaskState.showBottom
        ? "both"
        : scrollMaskState.showTop
          ? "top"
          : scrollMaskState.showBottom
            ? "bottom"
            : "none";

    return (
      <CollapsibleContent
        data-reasoning-content="true"
        data-reasoning-content-variant={variant}
        data-testid={TID_CHAT_REASONING_CONTENT}
        forceMount={forceMount}
        className={className}
        {...props}
      >
        {shouldRenderChildren ? (
          <div className="pt-2">
            <div
              ref={scrollRef}
              className={cn(
                "max-h-[220px] space-y-2 overflow-auto rounded-lg bg-foreground/[0.04] px-3 py-2 font-mono text-foreground-subtle",
                // CUA Group 已提供清晰的父级边界；子思考继续显示左导线与缩进会形成重复层级。
              )}
              data-reasoning-scroll-mask={scrollMaskData}
              onScroll={handleScroll}
              style={{ ...scrollMaskStyle }}
            >
              {/* 思考块之前打开时把 Radix content 一起按需挂载并强制 forceMount，
                  content 首帧已经是 open 状态，高度动画来不及从 closed 状态过渡，看起来像突然展开。
                  这里和工具详情保持一致：CollapsibleContent 只负责 Presence/高度动画，重内容单独延迟卸载；
                  间距放在动画内容内部，避免 closed 动画结束时父级 gap/padding 被移除造成末帧跳动。
                  性能修复：thought 内容可能非常长且会流式追加，展开后如果继续走 MessageResponse/Streamdown，
                  每次 chunk 都会重跑 Markdown 解析和插件渲染，字数越多越卡；这里按纯文本展示并保留换行。 */}
              <div
                ref={contentRef}
                className="min-w-0 whitespace-pre-wrap break-words text-foreground-subtle"
              >
                {typeof children === "string" ? stripDisplayEmoji(children) : children}
              </div>
            </div>
          </div>
        ) : null}
      </CollapsibleContent>
    );
  },
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
