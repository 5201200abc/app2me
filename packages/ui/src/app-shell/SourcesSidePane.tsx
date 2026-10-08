import {
  ConversationSourceImagePreview,
  isImageSource,
} from "@/v4/ConversationSourceImagePreview.js";
import { useEffect, useMemo, useState } from "react";
import type { SourcesSidePaneTab } from "@/lib/workspaceSidePane.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { useMyCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { V4PaneConversationProvider, useV4Conversation } from "@/v4/V4ConversationContext.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { getConversationSourceNameResolver } from "@/v4/conversationSourceNames.js";
import { buildConversationInventory } from "@/v4/conversationInventoryModel.js";
import { ConversationSourcesTab } from "@/v4/ConversationSourcesTab.js";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import type { ConversationInventoryItem } from "@/v4/conversationInventoryModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

export function SourcesSidePaneContent(props: SourcesProps) {
  const { tab } = props;
  return (
    <SourcesContent
      key={JSON.stringify([
        tab.workspaceIdentity?.trim() || tab.workspacePath,
        tab.parentSessionId,
      ])}
      {...props}
    />
  );
}

function SourcesContent({ tab, onOpenBrowserUrl, onOpenCodeViewer }: SourcesProps) {
  const { layer, attachmentRead } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);
  const [selected, setSelected] = useState<ConversationInventoryItem | null>(null);
  const [failed, setFailed] = useState(false);
  const state = useConversationProjection(lease);
  const theme = useMyCodeStoreWithDefault((store) => store.theme, "system");
  useEffect(() => {
    const next = layer.acquire(tab.parentSessionId);
    setLease(next);
    return () => next.release();
  }, [layer, tab.parentSessionId]);
  const epoch = state.snapshot?.logEpoch;
  useEffect(() => {
    if (!epoch || !lease) return;
    let disposed = false;
    void lease.store.loadAllOlder({ includeSingleQueryHistory: true }).then((result) => {
      if (!disposed) setFailed(result.status === "retryable-failure");
    });
    return () => {
      disposed = true;
    };
  }, [epoch, lease]);
  useEffect(() => setSelected(null), [epoch]);
  const rows = state.snapshot?.rows.window ?? [];
  const inventory = useMemo(
    () =>
      buildConversationInventory(
        rows,
        tab.workspacePath,
        undefined,
        lease ? getConversationSourceNameResolver(lease.store) : undefined,
      ),
    [rows, tab.workspacePath, lease],
  );
  const context: ConversationRowRenderContext = {
    workspacePath: tab.workspacePath,
    workspaceIdentity: tab.workspaceIdentity,
    workspaceRemoteSessionId: tab.remoteSessionId,
    sessionId: tab.parentSessionId,
    logEpoch: epoch,
    theme,
    codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
    readAttachment: attachmentRead,
    onOpenBrowserUrl,
    onOpenCodeViewer,
  };
  const row = selected ? rows.find((item) => item.rowId === selected.rowId) : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-background p-4" data-sources-side-pane>
      <ConversationSourcesTab
        items={inventory.sources}
        webActivity={inventory.webActivity}
        context={context}
        onOpen={(item) => {
          if (item.kind === "web" && item.path && onOpenBrowserUrl) onOpenBrowserUrl(item.path);
          else setSelected(item);
        }}
      />
      {state.loadingOlder ? (
        <p className="text-ui-caption text-foreground-subtlest">正在加载</p>
      ) : null}
      {failed ? (
        <button
          type="button"
          className="text-left text-ui-caption text-foreground-subtlest"
          onClick={() => {
            void lease?.store
              .loadAllOlder({ includeSingleQueryHistory: true })
              .then((result) => setFailed(result.status === "retryable-failure"));
          }}
        >
          加载失败，点击重试
        </button>
      ) : null}
      {isImageSource(selected) ? (
        <ConversationSourceImagePreview
          key={selected.key}
          item={selected}
          context={context}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {row && !isImageSource(selected) ? (
        <div className="max-h-[220px] shrink-0 overflow-auto rounded-lg bg-foreground/[0.04] p-3">
          <button
            type="button"
            className="mb-2 text-ui-caption text-foreground-subtlest"
            onClick={() => setSelected(null)}
          >
            关闭预览
          </button>
          <ConversationRowView row={row} context={context} />
        </div>
      ) : null}
    </div>
  );
}

interface SourcesProps {
  tab: SourcesSidePaneTab;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
}
export function SourcesSidePane(props: SourcesProps) {
  const scope = useMemo(
    () => ({
      workspacePath: props.tab.workspacePath,
      workspaceIdentity: props.tab.workspaceIdentity,
      remoteSessionId: props.tab.remoteSessionId,
    }),
    [props.tab.workspacePath, props.tab.workspaceIdentity, props.tab.remoteSessionId],
  );
  return (
    <V4PaneConversationProvider scope={scope}>
      <SourcesSidePaneContent key={props.tab.id} {...props} />
    </V4PaneConversationProvider>
  );
}
