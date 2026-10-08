import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRightIcon } from "@/components/icons/tabler.js";
import { testId, TID_TOOL_SUMMARY_TRIGGER } from "@mycode/shared";
import { cn } from "@/components/lib/utils.js";
import { CollapsibleTrigger } from "@/components/ui/collapsible.js";
import { ProcessRowContent } from "@/components/ui/process-row.js";
import { QueuedSummaryContent } from "@/ToolCallBlocks/QueuedSummaryContent.js";

export interface ToolSummaryAction {
  ariaLabel: string;
  onActivate: () => void;
  testId?: string;
}

function handleToolSummaryActionKeyDown(
  event: Pick<KeyboardEvent<HTMLDivElement>, "key" | "preventDefault">,
  onActivate: () => void,
): boolean {
  if (event.key !== "Enter" && event.key !== " ") {
    return false;
  }

  event.preventDefault();
  onActivate();
  return true;
}

interface ToolSummaryRowProps {
  inlineChevron?: boolean;
  action?: ToolSummaryAction;
  animateContent: boolean;
  canToggle: boolean;
  contentKey: string;
  contentRefreshVersion?: string;
  diffCount?: ReactNode;
  disableContentAnimation: boolean;
  forceOpen: boolean;
  icon: ReactNode;
  isExpanded: boolean;
  kindDetail?: ReactNode;
  kindLabel: ReactNode;
  kindLabelClassName: string;
  primaryText: ReactNode;
  prioritizePrimaryText?: boolean;
  secondaryText?: ReactNode;
  separator?: ReactNode;
  showIcon: boolean;
  sourceLabel?: ReactNode;
  statusNode?: ReactNode;
  title?: string;
  toggleAriaLabel: string;
  toolId: string;
  summaryText?: string;
  fileSentence?: boolean;
  fileActivity?: boolean;
}

function SummaryLeadingContent({
  icon,
  kindDetail,
  kindLabel,
  kindLabelClassName,
  showIcon,
  sourceLabel,
  prioritizePrimaryText,
}: Pick<
  ToolSummaryRowProps,
  | "icon"
  | "kindDetail"
  | "kindLabel"
  | "kindLabelClassName"
  | "prioritizePrimaryText"
  | "showIcon"
  | "sourceLabel"
>) {
  return (
    <>
      {showIcon ? (
        <span className="shrink-0 text-foreground-subtlest [&_svg]:size-3.5 [&_svg]:stroke-2 [&_svg]:text-foreground-subtlest">
          {icon}
        </span>
      ) : null}
      {kindLabel != null && kindLabel !== false && kindLabel !== "" ? (
        <span
          className={cn(
            "tool-summary-kind-label min-w-0 overflow-hidden text-ellipsis",
            kindLabelClassName,
            prioritizePrimaryText && "@max-[360px]/conversation:hidden",
          )}
        >
          {kindLabel}
        </span>
      ) : null}
      {kindDetail ? <span className="min-w-0 shrink-0">{kindDetail}</span> : null}
      {sourceLabel ? (
        <span
          className={cn(
            "shrink-0 text-ui-caption text-foreground-subtlest",
            prioritizePrimaryText && "@max-[360px]/conversation:hidden",
          )}
        >
          {sourceLabel}
        </span>
      ) : null}
    </>
  );
}

function SummaryContent({
  animateContent,
  contentKey,
  contentRefreshVersion,
  diffCount,
  disableContentAnimation,
  isExpanded,
  primaryText,
  prioritizePrimaryText,
  secondaryText,
  separator,
  statusNode,
}: Pick<
  ToolSummaryRowProps,
  | "animateContent"
  | "contentKey"
  | "contentRefreshVersion"
  | "diffCount"
  | "disableContentAnimation"
  | "isExpanded"
  | "primaryText"
  | "prioritizePrimaryText"
  | "secondaryText"
  | "separator"
  | "statusNode"
>) {
  const hasSummaryContent = [primaryText, secondaryText, diffCount, statusNode].some(
    (node) => node != null && node !== false && node !== "",
  );

  // 展开态可能主动清空摘要，但渲染空 flex 容器的话，标题行的 gap
  // 会在“类别—空容器—箭头”之间计算两次，视觉上形成一块异常大的空白。
  if (!hasSummaryContent) {
    return null;
  }

  return (
    <div
      className={cn(
        "tool-summary-content flex min-w-0 flex-1 overflow-hidden max-w-full items-center gap-1.5 text-foreground-subtlest",
        prioritizePrimaryText && "flex-1 overflow-hidden",
      )}
    >
      {separator != null ? (
        <span className="shrink-0 text-foreground-subtlest">{separator}</span>
      ) : null}
      <QueuedSummaryContent
        contentKey={contentKey}
        contentRefreshVersion={contentRefreshVersion}
        primaryText={primaryText}
        secondaryText={secondaryText}
        trailingText={diffCount}
        enabled={animateContent && !isExpanded}
        disableAnimation={disableContentAnimation}
      />
      {statusNode != null ? <span data-process-stat>{statusNode}</span> : null}
    </div>
  );
}

export function ToolSummaryRow(props: ToolSummaryRowProps) {
  const { action, canToggle, forceOpen, isExpanded, title, toggleAriaLabel, toolId } = props;
  if (props.summaryText !== undefined) {
    const content = (
      <ProcessRowContent icon={props.icon} showIcon={props.showIcon}>
        <span
          data-tool-summary-sentence="true"
          className="min-w-0 shrink truncate font-sans font-normal text-foreground-subtle"
        >
          {props.summaryText}
        </span>
        {props.statusNode != null ? <span data-process-stat>{props.statusNode}</span> : null}
        {canToggle ? (
          <ChevronRightIcon
            aria-hidden
            data-process-chevron
            className={cn(
              "size-3 shrink-0 text-foreground-subtlest transition-transform duration-200",
              isExpanded ? "rotate-90 opacity-100" : "rotate-0",
              forceOpen && "opacity-100",
            )}
          />
        ) : null}
      </ProcessRowContent>
    );
    const className =
      "group/tool-summary flex h-7 min-h-7 w-full min-w-0 items-center gap-1.5 rounded-lg text-left font-sans text-ui-base font-normal text-foreground-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused";
    // 命令句子没有内嵌文件预览按钮，可使用原生 button；其他摘要保留原来的交互结构。
    return canToggle ? (
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-process-row
          data-tool-summary-sentence-button="true"
          data-testid={testId(TID_TOOL_SUMMARY_TRIGGER, toolId)}
          aria-expanded={isExpanded}
          aria-label={toggleAriaLabel}
          className={cn(className, "cursor-pointer")}
          title={title}
        >
          {content}
        </button>
      </CollapsibleTrigger>
    ) : (
      <div
        data-process-row
        data-testid={testId(TID_TOOL_SUMMARY_TRIGGER, toolId)}
        className={cn(className, "cursor-default")}
        title={title}
      >
        {content}
      </div>
    );
  }
  const sharedContent = props.fileSentence ? (
    <>
      <span data-file-verb className="shrink-0 whitespace-nowrap font-normal">
        {props.kindLabel}
      </span>
      <span className="min-w-0 shrink overflow-hidden">{props.primaryText}</span>
      {props.diffCount}
      {props.fileActivity ? (
        <span
          data-file-activity
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
      ) : null}
      {props.statusNode != null ? <span data-process-stat>{props.statusNode}</span> : null}
    </>
  ) : (
    <>
      <SummaryLeadingContent {...props} showIcon={false} />
      <SummaryContent {...props} />
    </>
  );

  if (action) {
    return (
      <div
        data-process-row
        data-testid={action.testId ?? testId(TID_TOOL_SUMMARY_TRIGGER, toolId)}
        role="button"
        tabIndex={0}
        aria-label={action.ariaLabel}
        onClick={action.onActivate}
        onKeyDown={(event) => handleToolSummaryActionKeyDown(event, action.onActivate)}
        className="group/tool-summary flex h-7 min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg text-left text-ui-base text-foreground-subtlest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
        title={title}
      >
        <ProcessRowContent icon={props.icon} showIcon={props.showIcon}>
          {sharedContent}
        </ProcessRowContent>
      </div>
    );
  }

  if (canToggle) {
    return (
      <CollapsibleTrigger asChild>
        <div
          data-process-row
          data-testid={testId(TID_TOOL_SUMMARY_TRIGGER, toolId)}
          data-tool-file-sentence={props.fileSentence || undefined}
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={toggleAriaLabel}
          onKeyDown={(event) => {
            // 文件预览等子按钮自行处理键盘事件，不能同时触发父行折叠。
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }

            // 摘要内可能包含文件预览按钮，因此不能用满宽 button 包裹整行。
            // 保留 div trigger，并在这里补齐 Enter/Space 的展开能力。
            event.preventDefault();
            event.currentTarget.click();
          }}
          className="group/tool-summary flex h-7 min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg text-left text-ui-base text-foreground-subtlest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
          title={title}
        >
          <ProcessRowContent icon={props.icon} showIcon={props.showIcon}>
            {sharedContent}
            <ChevronRightIcon
              aria-hidden
              data-process-chevron
              className={cn(
                "size-3 shrink-0 text-foreground-subtlest transition-transform duration-200",
                props.fileSentence && "size-4 transition-[transform,opacity] duration-150",
                isExpanded ? "rotate-90 opacity-100" : "rotate-0",
                forceOpen && "opacity-100",
              )}
            />
          </ProcessRowContent>
        </div>
      </CollapsibleTrigger>
    );
  }

  return (
    <div
      data-process-row
      data-testid={testId(TID_TOOL_SUMMARY_TRIGGER, toolId)}
      className="group/tool-summary flex h-7 min-h-7 w-full min-w-0 cursor-default items-center gap-1.5 rounded-lg text-left text-ui-base text-foreground-subtlest transition-colors focus-visible:outline-none"
      title={title}
    >
      <ProcessRowContent icon={props.icon} showIcon={props.showIcon}>
        {sharedContent}
      </ProcessRowContent>
    </div>
  );
}
