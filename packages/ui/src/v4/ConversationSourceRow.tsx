import { useEffect, useState } from "react";
import { Cable, Copy, Globe2, Image, Search } from "@/components/icons/tabler.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { toast } from "@/components/ui/toast.js";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";
import type { ConversationInventoryItem } from "@/v4/conversationInventoryModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

export const SOURCE_KIND_LABELS = { screenshot: "截图", mcp: "MCP", search: "搜索", web: "网页" };

export function MiddleEllipsis({ text }: { text: string }) {
  const display = stripDisplayEmoji(text);
  const chars = Array.from(display);
  const split = Math.max(1, chars.length - Math.min(12, Math.ceil(chars.length / 3)));
  return (
    <span className="flex min-w-0 flex-1 overflow-hidden">
      <span className="min-w-0 truncate">{chars.slice(0, split).join("")}</span>
      <span className="shrink-0">{chars.slice(split).join("")}</span>
    </span>
  );
}

function SourceThumbnail({
  item,
  context,
  detail,
}: {
  item: ConversationInventoryItem;
  context: ConversationRowRenderContext;
  detail: boolean;
}) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const read = context.readAttachment,
    sessionId = context.sessionId;
  useEffect(() => {
    if (item.thumbnail || !item.ref || !item.mime?.startsWith("image/") || !read || !sessionId)
      return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void read({ sessionId, ref: item.ref, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        objectUrl =
          "url" in result
            ? undefined
            : URL.createObjectURL(
                new Blob([Uint8Array.from(result.bytes)], { type: result.mediaType }),
              );
        setUrl("url" in result ? result.url : objectUrl);
      })
      .catch(() => {
        /* 图片读取失败保留线性占位，不影响来源入口。 */
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.ref, item.mime, item.thumbnail, read, sessionId]);
  const image = item.thumbnail ?? url;
  return image ? (
    <img
      alt=""
      src={image}
      className={cn("shrink-0 rounded object-cover", detail ? "size-7" : "size-4")}
    />
  ) : (
    <Image
      aria-hidden
      className={cn(
        "shrink-0 stroke-[1.5] text-foreground-subtle",
        detail ? "size-7 p-1.5" : "size-4",
      )}
    />
  );
}

export function ConversationSourceRow({
  item,
  context,
  onOpen,
  detail = false,
}: {
  item: ConversationInventoryItem;
  context: ConversationRowRenderContext;
  onOpen: () => void;
  detail?: boolean;
}) {
  const kind =
    item.kind === "screenshot" ||
    item.kind === "mcp" ||
    item.kind === "search" ||
    item.kind === "web"
      ? item.kind
      : "web";
  const Icon = kind === "mcp" ? Cable : kind === "search" ? Search : Globe2;
  const tooltip = stripDisplayEmoji(
    [item.originalName, item.path ?? item.ref].filter(Boolean).join("\n") || item.label,
  );
  const copiedPath = item.path ?? item.ref;
  const attachmentDetail = detail && kind === "screenshot";
  const name = item.label;
  const time = item.createdAt
    ? new Date(item.createdAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
  return (
    <ControlHintTooltip title={tooltip} triggerClassName="!shrink min-w-0 w-full">
      <div
        className={cn(
          "group/source flex min-w-0 items-center gap-2 rounded-md hover:bg-foreground/[0.04]",
          attachmentDetail ? "min-h-20 py-2" : detail ? "h-11" : "h-7",
        )}
        data-source-kind={kind}
      >
        <button
          type="button"
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2 text-left font-normal text-foreground-subtle",
            detail ? "px-1 text-ui-base" : "px-0 text-ui-caption",
          )}
          onClick={onOpen}
        >
          {kind === "screenshot" ? (
            <SourceThumbnail item={item} context={context} detail={detail} />
          ) : (
            <Icon className="size-4 shrink-0" strokeWidth={1.5} />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("flex min-w-0", detail && "text-foreground")}>
              {!detail && kind === "screenshot" ? (
                <span data-source-name-fade>{stripDisplayEmoji(name)}</span>
              ) : (
                <MiddleEllipsis text={name} />
              )}
            </span>
            {attachmentDetail ? (
              <>
                {item.path ? (
                  <span
                    data-source-file-path
                    className="break-all text-ui-caption text-foreground-subtlest"
                  >
                    {stripDisplayEmoji(item.path)}
                  </span>
                ) : null}
                <span className="text-ui-caption text-foreground-subtlest">
                  Attached to the conversation
                </span>
              </>
            ) : detail ? (
              <span className="text-ui-caption text-foreground-subtlest">
                {SOURCE_KIND_LABELS[kind]}
                {time ? ` · ${time}` : ""}
              </span>
            ) : null}
          </span>
          {item.count && item.count > 1 ? (
            <span
              data-source-count
              className="shrink-0 text-ui-caption tabular-nums text-foreground-subtlest"
            >
              ×{item.count}
            </span>
          ) : null}
        </button>
        {detail && copiedPath ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover/source:opacity-100 focus-visible:opacity-100"
            aria-label="复制路径"
            title="复制路径"
            onClick={() => {
              void navigator.clipboard.writeText(copiedPath).catch(() => toast("复制路径失败"));
            }}
          >
            <Copy className="size-3.5" strokeWidth={1.5} />
          </Button>
        ) : null}
      </div>
    </ControlHintTooltip>
  );
}
