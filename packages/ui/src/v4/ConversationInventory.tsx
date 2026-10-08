import {
  ConversationSourceImagePreview,
  isImageSource,
} from "@/v4/ConversationSourceImagePreview.js";
import { useState } from "react";
import { Plus } from "@/components/icons/tabler.js";
import { DiffIcon } from "@/components/ui/diff-icon.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import "./conversation-inventory-changes.css";
import { Button } from "@/components/ui/button.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { getPathLeaf } from "@/lib/path.js";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";
import type {
  ConversationInventoryModel,
  ConversationInventoryItem,
} from "@/v4/conversationInventoryModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { ConversationRow } from "@mycode/shared/mycode-protocol-v4";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import { ConversationSourceRow } from "@/v4/ConversationSourceRow.js";
import { GlmMonochromeIcon } from "@/components/ui/GlmMonochromeIcon.js";
import { ConversationSourcesTab } from "@/v4/ConversationSourcesTab.js";
import { ConversationWebSearchSource } from "@/v4/ConversationWebSearchSource.js";
import type { ConversationTurnNavigatorHydrationResult } from "@/v4/conversationTurnNavigatorHelpers.js";

export interface ConversationInventoryProps {
  model: ConversationInventoryModel;
  context: ConversationRowRenderContext;
  hasOlder: boolean;
  onLoadAll: () => Promise<ConversationTurnNavigatorHydrationResult>;
  onLocate: (rowId: number) => void;
  onAddSource?: () => void;
  rows: readonly ConversationRow[];
}

export function ConversationInventory(props: ConversationInventoryProps) {
  const scope = JSON.stringify([
    props.context.workspaceIdentity?.trim() || props.context.workspacePath,
    props.context.sessionId,
    props.context.logEpoch,
  ]);
  return <InventoryContent key={scope} {...props} />;
}

function InventoryContent({
  model,
  context,
  hasOlder,
  onLoadAll,
  onLocate,
  onAddSource,
  rows,
}: ConversationInventoryProps) {
  const platform = useOptionalPlatform();
  const hasTools = Boolean(
    platform?.getDesktopToolEnvironment &&
    !context.workspaceIdentity &&
    !context.workspaceRemoteSessionId,
  );
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [tabOpen, setTabOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ConversationInventoryItem | null>(null);
  const selectedRow = selected ? rows.find((row) => row.rowId === selected.rowId) : undefined;
  const showAll = async () => {
    if (loading) return;
    if (context.onOpenSources && context.sessionId) {
      context.onOpenSources({
        parentSessionId: context.sessionId,
        workspacePath: context.workspacePath,
        ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
        ...(context.workspaceRemoteSessionId
          ? { remoteSessionId: context.workspaceRemoteSessionId }
          : {}),
      });
      return;
    }
    setTabOpen(true);
    // 历史在失败后由其他恢复路径加载完时，也必须清除旧错误，避免按钮永久停在重试。
    setFailed(false);
    if (!hasOlder) return;
    setLoading(true);
    try {
      // projection 返回 hydrated/not-enough-queries，旧 completed 判断会把成功补齐误报失败。
      setFailed((await onLoadAll()).status === "retryable-failure");
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  const openItem = (item: ConversationInventoryItem) => {
    if (item.kind === "web" && item.path && context.onOpenBrowserUrl)
      context.onOpenBrowserUrl(item.path);
    else if (item.kind === "file" && item.path && context.onOpenCodeViewer)
      context.onOpenCodeViewer({
        type: "file",
        title: item.label,
        path: item.path,
        workspacePath: context.workspacePath,
        ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
        ...(context.workspaceRemoteSessionId
          ? { workspaceRemoteSessionId: context.workspaceRemoteSessionId }
          : {}),
      });
    else {
      setTabOpen(false);
      setSelected(item);
    }
  };
  const screenshotSources = model.sources.filter((item) => item.kind === "screenshot");
  const hasWebSources =
    model.sources.some((item) => item.kind === "search" || item.kind === "web") ||
    Boolean(model.webActivity?.searches || model.webActivity?.pages);
  const activeChanges = model.changes.filter((change) => change.summary.state !== "reverted");
  const sums = activeChanges.reduce(
    (sum, change) => ({
      added: sum.added + change.summary.additions,
      removed: sum.removed + change.summary.deletions,
    }),
    { added: 0, removed: 0 },
  );
  const { intl, locale } = useMyCodeIntl();
  const numberFormat = new Intl.NumberFormat(locale);
  const title =
    stripDisplayEmoji(getPathLeaf(context.workspacePath.replace(/[\\/]+$/, ""))) || "产物";
  return (
    <section data-conversation-inventory="" className="flex min-w-0 flex-col gap-4 p-4">
      <Dialog modal={false} open={tabOpen} onOpenChange={setTabOpen}>
        <DialogContent
          data-sources-side-pane
          showOverlay={false}
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          className="inset-y-0 right-0 left-auto flex h-dvh w-[380px] max-w-[90vw] translate-x-0 translate-y-0 flex-col rounded-none border-0 border-l border-border bg-background shadow-none"
        >
          <DialogHeader>
            <DialogTitle>Sources</DialogTitle>
          </DialogHeader>
          <ConversationSourcesTab
            items={model.sources}
            webActivity={model.webActivity}
            context={context}
            onOpen={openItem}
          />
          {loading ? <p className="text-ui-caption text-foreground-subtlest">正在加载</p> : null}
          {failed ? (
            <button
              type="button"
              className="text-left text-ui-caption text-foreground-subtlest"
              onClick={() => void showAll()}
            >
              加载失败，点击重试
            </button>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedRow) && !isImageSource(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-[min(760px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="truncate text-ui-base">{selected?.label}</DialogTitle>
          </DialogHeader>
          {selectedRow ? (
            <div className="max-h-[60dvh] overflow-auto">
              <ConversationRowView row={selectedRow} context={context} />
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (selected) onLocate(selected.rowId);
              setSelected(null);
            }}
          >
            定位到对话
          </Button>
        </DialogContent>
      </Dialog>
      {isImageSource(selected) ? (
        <ConversationSourceImagePreview
          key={selected.key}
          item={selected}
          context={context}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <section className="min-w-0">
        <div data-inventory-title-row className="group flex h-7 min-w-0 items-center gap-2">
          <h3
            className="min-w-0 flex-1 truncate text-ui-sm font-normal text-foreground-subtle"
            title={context.workspacePath}
          >
            {title === "default" ? "Default" : title}
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 text-foreground-subtlest"
                aria-label="产物菜单"
              >
                <Plus className="size-4" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!model.sources.length && !hasWebSources && !hasTools}
                onSelect={() => {
                  void showAll();
                }}
              >
                Sources
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {activeChanges.length ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 border-x-0 pr-0.5 pl-0 py-0 text-ui-sm font-normal text-foreground"
            onClick={() => onLocate(activeChanges.at(-1)!.rowId)}
            data-inventory-change=""
          >
            <DiffIcon className="size-4.5 shrink-0" strokeWidth={1.5} />
            <span className="text-ui-caption">
              {intl.formatMessage({ id: "chat.inventory.changesLabel" })}
            </span>
            <span className="ml-auto flex gap-1 whitespace-nowrap font-sans text-ui-sm font-normal tabular-nums">
              <span data-inventory-added>+{numberFormat.format(sums.added)}</span>
              <span data-inventory-removed>-{numberFormat.format(sums.removed)}</span>
            </span>
          </Button>
        ) : null}
        {!activeChanges.length ? (
          <p
            data-inventory-empty
            className="flex h-7 items-center justify-center text-center text-ui-caption font-normal text-foreground-subtlest"
          >
            暂无可用信息
          </p>
        ) : null}
      </section>
      {model.sources.length || hasWebSources || hasTools ? (
        <section className="min-w-0">
          <div data-inventory-title-row className="flex h-7 items-center gap-2">
            <button
              type="button"
              data-inventory-source-title
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-ui-sm font-normal text-foreground-subtle"
              aria-expanded={sourcesOpen}
              onClick={() => setSourcesOpen(!sourcesOpen)}
            >
              <span>Sources</span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-foreground-subtlest"
              aria-label="添加来源"
              disabled={!onAddSource}
              onClick={onAddSource}
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </Button>
          </div>
          {sourcesOpen ? (
            <>
              {screenshotSources.slice(hasWebSources || hasTools ? -2 : -3).map((item) => (
                <ConversationSourceRow
                  key={item.key}
                  item={item}
                  context={context}
                  onOpen={() => openItem(item)}
                />
              ))}
              {hasWebSources ? (
                <ConversationWebSearchSource
                  activity={model.webActivity ?? { searches: 0, pages: 0 }}
                  onOpen={() => void showAll()}
                />
              ) : null}
              {hasTools ? (
                <button
                  type="button"
                  onClick={() => void showAll()}
                  data-source-summary-row
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-0 text-left text-ui-caption text-foreground-subtle hover:bg-foreground/[0.04]"
                >
                  <GlmMonochromeIcon className="size-4 shrink-0 opacity-80" />
                  <span className="truncate">Mycode App Tools</span>
                </button>
              ) : null}
              <button
                type="button"
                data-inventory-view-all
                className="flex h-7 items-center text-ui-sm font-normal text-foreground-subtlest"
                disabled={loading}
                onClick={() => void showAll()}
              >
                {loading ? "正在加载" : failed ? "加载失败，点击重试" : "查看全部"}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
