import {
  FileDisplayIcon,
  getFileDisplayPath,
  resolveFileDisplayDescriptor,
} from "@/lib/fileDisplay.js";
import { FlipMetricValue } from "@/components/ui/flip-metric-value.js";
import { getPathLeaf } from "@/lib/path.js";
import { inferEditOperation } from "@/ToolCallBlocks/fileSummaries.js";
import { cn } from "@/components/lib/utils.js";
import type {
  EditKindSource,
  EditKindLabelId,
  EditOperationKind,
  RawToolCallFileSummary,
} from "@/ToolCallBlocks/fileSummaryTypes.js";

export function renderDiffCount(
  changeStat?: {
    added: number;
    removed: number;
  },
  options?: { animateInitial?: boolean; sentence?: boolean },
) {
  if (!changeStat) {
    return null;
  }

  return (
    <span
      data-tool-diff-count
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-normal leading-none tabular-nums",
        options?.sentence
          ? "shrink-0 font-sans text-ui-base text-foreground-subtle"
          : "text-ui-xs font-mono text-foreground-subtlest",
      )}
    >
      <span
        aria-label={`+${changeStat.added}`}
        data-file-added={options?.sentence || undefined}
        className="inline-flex items-center"
        role="text"
        title={`+${changeStat.added}`}
      >
        +{/* 性能修复：投影已按秒给出真实统计，数字只做一次短翻页，不再逐行 rAF 追赶。 */}
        <FlipMetricValue
          value={String(changeStat.added)}
          animateInitial={options?.animateInitial}
        />
      </span>
      <span
        aria-label={`-${changeStat.removed}`}
        data-file-removed={options?.sentence || undefined}
        className="inline-flex items-center"
        role="text"
        title={`-${changeStat.removed}`}
      >
        -
        <FlipMetricValue
          value={String(changeStat.removed)}
          animateInitial={options?.animateInitial}
        />
      </span>
    </span>
  );
}

export function renderFileChip({
  summary,
  clickable = false,
  onClick,
  title,
  basePath,
  sentence = false,
}: {
  summary: RawToolCallFileSummary;
  clickable?: boolean;
  onClick?: () => void;
  title?: string;
  basePath?: string;
  sentence?: boolean;
}) {
  const descriptor = resolveFileDisplayDescriptor(summary.path, {
    basePath,
  });
  const chipTitle = title ?? getFileDisplayPath(summary.path, basePath);
  const fileName = (
    <span
      data-file-name={sentence || undefined}
      className={cn(
        "min-w-0 truncate",
        sentence
          ? "text-foreground-subtle underline decoration-dotted decoration-1 underline-offset-[3px]"
          : "text-foreground-subtlest",
      )}
    >
      {getPathLeaf(summary.path)}
    </span>
  );
  const className = cn(
    "inline-flex min-w-0 max-w-full items-center gap-1.5 text-ui-base font-normal",
    sentence ? "text-foreground-subtle font-sans" : "text-foreground-subtlest",
    clickable && !sentence && "hover:underline",
  );

  if (clickable) {
    return (
      <button
        type="button"
        className={className}
        title={chipTitle}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        {!sentence ? (
          <FileDisplayIcon src={descriptor.fileIconSrc} size={14} className="size-3.5 shrink-0" />
        ) : null}
        {fileName}
      </button>
    );
  }

  return (
    <span className={className} title={chipTitle}>
      {!sentence ? (
        <FileDisplayIcon src={descriptor.fileIconSrc} size={14} className="size-3.5 shrink-0" />
      ) : null}
      {fileName}
    </span>
  );
}

export function renderFilePath(path: string | null | undefined, basePath?: string) {
  if (!path) {
    return null;
  }

  return (
    <span
      data-tool-file-path
      className="min-w-0 truncate text-foreground-subtlest @max-[360px]/conversation:hidden"
    >
      {/* 窄会话流里父目录会与文件名争抢空间，Read/Edit 最终只剩动作标签和省略号。
          小容器隐藏次要路径，让文件名继续承担主识别信息。 */}
      {getFileDisplayPath(path, basePath)}
    </span>
  );
}

export function getEditKindLabelMessageId(
  operationKinds: EditOperationKind[],
  actionLabels: Array<RawToolCallFileSummary["actionLabel"]>,
  isRunning: boolean,
  source?: EditKindSource,
): EditKindLabelId {
  const inferredOperation = inferEditOperation(operationKinds, actionLabels, source);

  if (inferredOperation === "write") {
    return isRunning ? "chat.toolCall.edit.writing" : "chat.toolCall.kind.write";
  }

  if (inferredOperation === "delete") {
    return isRunning ? "chat.toolCall.edit.deleting" : "chat.toolCall.kind.delete";
  }

  if (actionLabels.length === 0) {
    return isRunning ? "chat.toolCall.edit.editing" : "chat.toolCall.kind.edit";
  }

  return isRunning ? "chat.toolCall.edit.editing" : "chat.toolCall.kind.edit";
}

export function renderJoinedFileChips(
  summaries: RawToolCallFileSummary[],
  options: {
    clickable?: boolean;
    onClick?: (summary: RawToolCallFileSummary) => void;
    basePath?: string;
  } = {},
) {
  return (
    <div className="inline-flex min-w-0 items-center">
      {summaries.map((summary, index) => (
        <span key={summary.path} className="inline-flex min-w-0 items-center">
          {index > 0 ? <span className="mx-1 text-foreground-subtlest">,</span> : null}
          {renderFileChip({
            summary,
            clickable: options.clickable,
            basePath: options.basePath,
            onClick: options.onClick ? () => options.onClick?.(summary) : undefined,
          })}
        </span>
      ))}
    </div>
  );
}
