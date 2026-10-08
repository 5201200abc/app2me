import { Globe2 } from "@/components/icons/tabler.js";
import { cn } from "@/components/lib/utils.js";
import type { ConversationInventoryModel } from "@/v4/conversationInventoryModel.js";

export function ConversationWebSearchSource({
  activity,
  onOpen,
  expanded,
  detail = false,
}: {
  activity: NonNullable<ConversationInventoryModel["webActivity"]>;
  onOpen: () => void;
  expanded?: boolean;
  detail?: boolean;
}) {
  return (
    <button
      data-source-summary-row
      type="button"
      data-source-web-search
      aria-expanded={expanded}
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 gap-2 rounded-md px-0 text-left hover:bg-foreground/[0.04]",
        detail ? "items-start py-2" : "h-7 items-center",
      )}
    >
      <Globe2
        className={cn("size-4 shrink-0 text-foreground-subtle", detail && "mt-0.5")}
        strokeWidth={1.5}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui-caption text-foreground-subtle">Web search</span>
        {detail ? (
          <>
            <span className="text-ui-sm text-foreground-subtlest">
              Searched {activity.searches} times
            </span>
            <span className="text-ui-sm text-foreground-subtlest">
              Opened {activity.pages} pages
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}
