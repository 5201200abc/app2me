import { useState } from "react";
import { ConversationSourceRow } from "@/v4/ConversationSourceRow.js";
import type {
  ConversationInventoryItem,
  ConversationInventoryModel,
} from "@/v4/conversationInventoryModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { ConversationToolEnvironment } from "@/v4/ConversationToolEnvironment.js";
import { ConversationWebSearchSource } from "@/v4/ConversationWebSearchSource.js";

export function ConversationSourcesTab({
  items,
  webActivity,
  context,
  onOpen,
}: {
  items: readonly ConversationInventoryItem[];
  webActivity?: ConversationInventoryModel["webActivity"];
  context: ConversationRowRenderContext;
  onOpen: (item: ConversationInventoryItem) => void;
}) {
  const [webOpen, setWebOpen] = useState(false);
  const screenshots = items.filter((item) => item.kind === "screenshot");
  const webItems = items.filter((item) => item.kind === "web" || item.kind === "search");
  return (
    <div
      data-conversation-sources-tab=""
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto"
    >
      {screenshots.length ? (
        <section className="min-w-0">
          {screenshots.map((item) => (
            <ConversationSourceRow
              key={item.key}
              item={item}
              context={context}
              detail
              onOpen={() => onOpen(item)}
            />
          ))}
        </section>
      ) : null}
      {webItems.length || webActivity?.searches || webActivity?.pages ? (
        <section className="min-w-0">
          <ConversationWebSearchSource
            detail
            activity={
              webActivity ?? {
                searches: webItems.filter((item) => item.kind === "search").length,
                pages: webItems.filter((item) => item.kind === "web").length,
              }
            }
            expanded={webOpen}
            onOpen={() => setWebOpen(!webOpen)}
          />
          {webOpen
            ? webItems.map((item) => (
                <ConversationSourceRow
                  key={item.key}
                  item={item}
                  context={context}
                  detail
                  onOpen={() => onOpen(item)}
                />
              ))
            : null}
        </section>
      ) : null}
      <ConversationToolEnvironment
        enabled={!context.workspaceIdentity && !context.workspaceRemoteSessionId}
      />
    </div>
  );
}
