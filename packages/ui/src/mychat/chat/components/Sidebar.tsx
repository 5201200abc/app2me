import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { Conversation, Language } from "@mycode/shared/mychat";
import { Search, MessageCirclePlus, Trash2, X } from "@/components/icons/tabler.js";
import { Button } from "@/components/ui/button.js";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { cn } from "@/components/lib/utils.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";

type Props = {
  footer?: ReactNode;
  language?: Language;
  chats: Conversation[];
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onToggleSidebar?: () => void;
  collapsed?: boolean;
  empty?: boolean;
  headerSearch?: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
};

export function Sidebar(props: Props) {
  const { intl } = useMyCodeIntl();
  const isZh = (props.language ?? "en") === "zh";
  const searchLabel = isZh ? "搜索" : "Search";
  const searchShortcut = useShortcutCommandLabel("openCommandCenter");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (searchOpen && !props.collapsed) props.searchRef.current?.focus();
  }, [searchOpen, props.collapsed, props.searchRef]);
  const openSearch = () => {
    if (props.collapsed) props.onToggleSidebar?.();
    setSearchOpen(true);
  };
  return (
    <aside
      className={cn("sidebar workspace-sidebar", props.collapsed && "collapsed")}
      data-testid="mychat-sidebar"
    >
      <div className="h-12 shrink-0 [app-region:drag]" />
      {props.collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 p-2 pt-3">
          <Button
            variant="ghost"
            size="icon-md"
            aria-label={isZh ? "新会话" : "New chat"}
            onClick={props.onNew}
          >
            <MessageCirclePlus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-md" aria-label={searchLabel} onClick={openSearch}>
            <Search className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <div data-sidebar-primary-actions className="flex flex-col gap-0.5 px-2 py-2.5">
            <NewTaskButtonGroup onCreateTask={props.onNew} selected={props.empty} />
            {!props.headerSearch ? (
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-start gap-2 text-foreground hover:bg-surface-hover"
                onClick={openSearch}
              >
                <Search className="size-4" />
                <span className="min-w-0 flex-1 truncate text-left">{searchLabel}</span>
                <span className="ml-auto shrink-0 text-ui-xs font-normal text-foreground-subtlest">
                  {searchShortcut}
                </span>
              </Button>
            ) : null}
          </div>
          <div className={cn("side-search-bar", !searchOpen && !props.query && "sr-only")}>
            <input
              ref={props.searchRef}
              placeholder={isZh ? "搜索历史会话..." : "Search conversations..."}
              value={props.query}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => props.onQuery(event.target.value)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={isZh ? "关闭搜索" : "Close search"}
              onClick={() => {
                props.onQuery("");
                setSearchOpen(false);
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <div className="recents-group">
            <div className="px-4 py-2 text-ui-sm font-normal text-foreground-subtlest">
              {isZh ? "最近的" : "Recent"}
            </div>
            <div className="chats">
              {props.chats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group/chat flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-lg px-2.5 hover:bg-surface-hover",
                    chat.id === props.activeId && "bg-selected",
                  )}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-ui-caption text-foreground"
                    onClick={() => props.onSelect(chat.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {chat.title || (isZh ? "新会话" : "New chat")}
                    </span>
                    <span className="shrink-0 text-ui-sm text-foreground-subtlest">
                      {formatTaskRelativeTime(chat.updatedAt, intl)}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-5 shrink-0 opacity-0 group-hover/chat:opacity-100 focus-visible:opacity-100"
                    aria-label={isZh ? "删除会话" : "Delete chat"}
                    onClick={() => props.onDelete(chat.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {props.footer}
    </aside>
  );
}
