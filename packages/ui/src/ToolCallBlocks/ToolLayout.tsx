import {
  ToolPresentationScopeContext,
  ToolPresentationStatusContext,
  ToolOperationListContext,
} from "@/ToolCallBlocks/ToolPresentationContext.js";
import "@/ToolCallBlocks/operationList.css";
import { cleanToolDisplayNode } from "@/ToolCallBlocks/displayText.js";
import { memo, type ReactNode, useEffect, useRef, useState, useContext } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { CheckIcon, CopyIcon, XIcon } from "@/components/icons/tabler.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { ToolSummaryRow, type ToolSummaryAction } from "@/ToolCallBlocks/ToolSummaryRow.js";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";

const toolLayoutOpenState = new Map<string, boolean>();
// 内存诊断计数器：该表按 toolId 只增不减，先落日志。
uiMemoryDiagnosticsRegistry.register("toolLayout", () => ({ openState: toolLayoutOpenState.size }));
const TOOL_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS = 300;
const TOOL_CONTENT_SHELL_CLASSNAME = "text-popover-foreground outline-none";
const TOOL_CONTENT_SPACING_CLASSNAME = "tool-detail-scroll mt-1 text-foreground-subtle";

interface ToolLayoutProps {
  variant?: "default" | "operations" | "image";
  toolId: string;
  persistOpenKey?: string;
  icon: ReactNode;
  showIcon?: boolean;
  preserveIcon?: boolean;
  canToggle?: boolean;
  forceOpen?: boolean;
  kindLabel: ReactNode;
  expandedKindLabel?: ReactNode;
  kindDetail?: ReactNode;
  expandedKindDetail?: ReactNode;
  sourceLabel?: ReactNode;
  primaryText: ReactNode;
  prioritizePrimaryText?: boolean;
  expandedPrimaryText?: ReactNode;
  secondaryText?: ReactNode;
  expandedSecondaryText?: ReactNode;
  summaryContentSeparator?: ReactNode;
  animateSummaryContent?: boolean;
  disableSummaryContentAnimation?: boolean;
  summaryContentKey?: string;
  summaryContentRefreshVersion?: string;
  hideSecondaryTextWhenOpen?: boolean;
  diffCount?: ReactNode;
  hideDiffCountWhenOpen?: boolean;
  statusLabel?: ReactNode;
  statusTooltip?: ReactNode;
  /**
   * 状态词之前的指示物（如编译反馈行的空环灯），与状态词同显同隐。放在提示触发区之外：
   * 虚线下划线与悬停提示只属于词，灯不该被划线，也不该成为另一个悬停目标。
   */
  statusIndicator?: ReactNode;
  showStatusLabel?: boolean;
  showFailureStatus?: boolean;
  isRunning?: boolean;
  title?: string;
  expandedTitle?: string;
  content?: ReactNode;
  renderContent?: () => ReactNode;
  summaryAction?: ToolSummaryAction;
  /** 无内部预览按钮的命令摘要，以同一行句子渲染并使用原生 button。 */
  summaryText?: string;
  /** 单文件句子仅改变摘要布局，保留文件预览与父行折叠的独立事件。 */
  fileSentence?: boolean;
}

function ToolLayoutComponent({
  variant = "default",
  toolId,
  persistOpenKey,
  icon,
  showIcon = true,
  preserveIcon = false,
  canToggle: requestedCanToggle = true,
  forceOpen = false,
  kindLabel,
  expandedKindLabel,
  kindDetail,
  expandedKindDetail,
  sourceLabel,
  primaryText,
  prioritizePrimaryText = false,
  expandedPrimaryText,
  secondaryText,
  expandedSecondaryText,
  summaryContentSeparator,
  animateSummaryContent = false,
  disableSummaryContentAnimation = false,
  summaryContentKey,
  summaryContentRefreshVersion,
  hideSecondaryTextWhenOpen = false,
  diffCount,
  hideDiffCountWhenOpen = false,
  statusLabel,
  statusTooltip,
  statusIndicator,
  showStatusLabel = false,
  showFailureStatus = false,
  isRunning = false,
  title,
  expandedTitle,
  content,
  renderContent,
  summaryAction,
  summaryText,
  fileSentence,
}: ToolLayoutProps) {
  const { intl } = useMyCodeIntl();
  // 默认统一提供折叠入口；forceOpen 仅用于已展开工作流内部的叶节点。
  const canToggle = !forceOpen || requestedCanToggle;
  const scope = useContext(ToolPresentationScopeContext);
  const toolStatus = useContext(ToolPresentationStatusContext);
  const operationList = useContext(ToolOperationListContext);
  const resolvedPersistOpenKey = `${scope}:${persistOpenKey ?? toolId}`;
  const [isOpen, setIsOpen] = useState(
    () => toolLayoutOpenState.get(resolvedPersistOpenKey) ?? false,
  );
  const isExpanded = forceOpen || (canToggle && isOpen);
  const [shouldRenderContent, setShouldRenderContent] = useState(isExpanded);
  const [isFailureTooltipCopied, setIsFailureTooltipCopied] = useState(false);
  const failureTooltipCopyResetRef = useRef<number | null>(null);
  const contentUnmountDelayRef = useRef<number | null>(null);
  const shouldShowStatusLabel = (showStatusLabel || showFailureStatus) && statusLabel != null;
  const shouldRenderResolvedContent = isExpanded || shouldRenderContent;
  const resolvedContent = shouldRenderResolvedContent
    ? (renderContent?.() ?? content ?? null)
    : null;
  const summaryPrimaryText =
    isExpanded && expandedPrimaryText != null ? expandedPrimaryText : primaryText;
  const summaryKindLabel = isExpanded && expandedKindLabel != null ? expandedKindLabel : kindLabel;
  const summaryKindDetail =
    isExpanded && expandedKindDetail !== undefined ? expandedKindDetail : kindDetail;
  const summarySecondaryText =
    isExpanded && expandedSecondaryText !== undefined
      ? expandedSecondaryText
      : isExpanded && hideSecondaryTextWhenOpen && !operationList
        ? null
        : secondaryText;
  const summaryTitle = isExpanded && expandedTitle !== undefined ? expandedTitle : title;
  const resolvedSummaryContentKey =
    summaryContentKey ?? `${String(summaryTitle ?? "")}:${String(statusLabel ?? "")}`;
  const shouldShowDiffCount = diffCount != null && !(isExpanded && hideDiffCountWhenOpen);
  // toolcall 在流式期间数量多且持续更新，旋转 loading 图标会让
  // 动画长期占用渲染资源；运行态改由文案扫光和状态文字表达，图标保持静态。
  // 写入/编辑的笔用于识别操作类型，原来的状态替换会让失败行变成叉；保留笔，失败详情仍由状态提示呈现。
  const summaryIcon = preserveIcon ? (
    icon
  ) : toolStatus === "completed" && !operationList && variant === "default" ? (
    <CheckIcon className="size-3.5" strokeWidth={1.5} />
  ) : toolStatus === "failed" ? (
    <XIcon className="size-3.5" strokeWidth={1.5} />
  ) : (
    icon
  );
  // 运行态需要保留 kind 文案扫光，用来表达当前工具仍在进行中；
  // 非运行态仍保持最浅文本色，避免摘要信息喧宾夺主。
  const kindLabelClassName = cn(
    "font-medium whitespace-nowrap shrink-0",
    isRunning ? "animated-gradient-text" : "text-foreground-subtlest",
  );

  useEffect(() => {
    const persistedOpen = toolLayoutOpenState.get(resolvedPersistOpenKey);
    setIsOpen(persistedOpen ?? false);
  }, [resolvedPersistOpenKey]);

  useEffect(() => {
    if (isExpanded) {
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

    // 收起工具详情时不能立刻卸载 children。
    // Radix 会在 closed 动画里读取 --radix-collapsible-content-height；
    // 如果子内容先被卸载，内层高度变量会消失并继承外层历史消息的高度，
    // 导致详情区域短暂撑成超高空白块，下面内容看起来像全部闪没了。
    contentUnmountDelayRef.current = window.setTimeout(() => {
      setShouldRenderContent(false);
      contentUnmountDelayRef.current = null;
    }, TOOL_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS);

    return () => {
      if (contentUnmountDelayRef.current !== null) {
        window.clearTimeout(contentUnmountDelayRef.current);
        contentUnmountDelayRef.current = null;
      }
    };
  }, [isExpanded, shouldRenderContent]);

  useEffect(() => {
    return () => {
      if (failureTooltipCopyResetRef.current !== null) {
        window.clearTimeout(failureTooltipCopyResetRef.current);
      }
      if (contentUnmountDelayRef.current !== null) {
        window.clearTimeout(contentUnmountDelayRef.current);
      }
    };
  }, []);

  const handleCopyFailureTooltip = () => {
    if (typeof statusTooltip !== "string" || statusTooltip.trim().length === 0) {
      return;
    }

    navigator.clipboard.writeText(statusTooltip).then(() => {
      setIsFailureTooltipCopied(true);
      if (failureTooltipCopyResetRef.current !== null) {
        window.clearTimeout(failureTooltipCopyResetRef.current);
      }
      failureTooltipCopyResetRef.current = window.setTimeout(() => {
        setIsFailureTooltipCopied(false);
        failureTooltipCopyResetRef.current = null;
      }, 1500);
    });
  };

  const statusWordNode =
    shouldShowStatusLabel && statusLabel != null ? (
      statusTooltip ? (
        // 失败态不再强制展开内容，错误详情改挂到状态文字 tooltip 上，
        // 这样 edit 卡片保持和成功态一致的展开逻辑，同时仍然能在 hover 时拿到报错原因。
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="whitespace-nowrap underline decoration-dotted underline-offset-2 cursor-help">
                {statusLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-96">
              <div className="flex max-w-96 items-center gap-2">
                <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {statusTooltip}
                </span>
                {typeof statusTooltip === "string" && statusTooltip.trim().length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-md"
                    className="shrink-0"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleCopyFailureTooltip();
                    }}
                    title={intl.formatMessage({
                      id: isFailureTooltipCopied
                        ? "chat.toolCall.copyError.copied"
                        : "chat.toolCall.copyError",
                    })}
                    aria-label={intl.formatMessage({
                      id: isFailureTooltipCopied
                        ? "chat.toolCall.copyError.copied"
                        : "chat.toolCall.copyError",
                    })}
                  >
                    {isFailureTooltipCopied ? (
                      <CheckIcon className="size-3" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </Button>
                ) : null}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="whitespace-nowrap">{statusLabel}</span>
      )
    ) : null;
  const statusNode =
    statusWordNode !== null && statusIndicator != null ? (
      <span className="inline-flex shrink-0 items-center gap-1.5">
        {statusIndicator}
        {statusWordNode}
      </span>
    ) : (
      statusWordNode
    );

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(open) => {
        if (forceOpen) {
          return;
        }
        toolLayoutOpenState.set(resolvedPersistOpenKey, open);
        if (open) {
          setShouldRenderContent(true);
        }
        setIsOpen(open);
      }}
      data-tool-layout-variant={variant}
      data-operation-list-item={operationList || undefined}
      className="tool-call-layout flex w-full min-w-0 flex-col"
    >
      <ToolSummaryRow
        inlineChevron={variant !== "default"}
        animateContent={animateSummaryContent}
        canToggle={canToggle}
        contentKey={resolvedSummaryContentKey}
        contentRefreshVersion={summaryContentRefreshVersion}
        diffCount={shouldShowDiffCount ? diffCount : undefined}
        disableContentAnimation={disableSummaryContentAnimation}
        forceOpen={forceOpen}
        icon={summaryIcon}
        isExpanded={isExpanded}
        kindDetail={cleanToolDisplayNode(summaryKindDetail)}
        kindLabel={cleanToolDisplayNode(summaryKindLabel)}
        kindLabelClassName={kindLabelClassName}
        primaryText={cleanToolDisplayNode(summaryPrimaryText)}
        prioritizePrimaryText={prioritizePrimaryText}
        secondaryText={cleanToolDisplayNode(summarySecondaryText)}
        separator={summaryContentSeparator}
        showIcon={showIcon}
        sourceLabel={sourceLabel}
        statusNode={statusNode}
        title={summaryTitle}
        toggleAriaLabel={intl.formatMessage({
          id: isExpanded ? "chat.toolCall.collapseDetails" : "chat.toolCall.expandDetails",
        })}
        toolId={toolId}
        summaryText={summaryText}
        fileSentence={fileSentence}
        fileActivity={fileSentence && isRunning}
      />
      {canToggle ? (
        <CollapsibleContent className={TOOL_CONTENT_SHELL_CLASSNAME}>
          {/* padding 直接挂在高度动画节点上时，主体归零后仍会停在 8px，
              直到延迟卸载切换 display:none 才瞬间消失。放入内部后会被外层 overflow
              随动画高度连续裁切到 0，保留原间距且不改变 300ms 的测量保护。 */}
          <div className={TOOL_CONTENT_SPACING_CLASSNAME}>
            {summaryAction ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={summaryAction.onActivate}
                aria-label={summaryAction.ariaLabel}
              >
                {cleanToolDisplayNode(summaryAction.ariaLabel)}
              </Button>
            ) : null}
            {resolvedContent}
          </div>
        </CollapsibleContent>
      ) : forceOpen ? (
        <div className={cn(TOOL_CONTENT_SHELL_CLASSNAME, TOOL_CONTENT_SPACING_CLASSNAME)}>
          {resolvedContent}
        </div>
      ) : null}
    </Collapsible>
  );
}

function ScopedToolLayout(props: ToolLayoutProps) {
  const scope = useContext(ToolPresentationScopeContext);
  // 同 ID 的工具跨会话复用组件时，effect 清状态会短暂展示上个会话的详情；身份变化直接重建局部状态。
  return (
    <ToolLayoutComponent key={`${scope}:${props.persistOpenKey ?? props.toolId}`} {...props} />
  );
}

export const ToolLayout = memo(ScopedToolLayout);
ToolLayout.displayName = "ToolLayout";
