import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HISTORY_PUSH_TAG } from "lexical";
import { GoalIcon, XIcon } from "@/components/icons/tabler.js";
import { Button } from "@/components/ui/button.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { $getLeadingGoalCommand, $removeLeadingGoalCommand } from "./leadingGoalCommand.js";

/** 标记是 Lexical 原节点的展示投影，草稿与发送始终走原有 markdown 序列化。 */
export function LeadingGoalToolbarPlugin({
  container,
  disabled,
}: {
  container?: HTMLElement | null;
  disabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const { intl } = useMyCodeIntl();
  const [goalKey, setGoalKey] = useState<string | null>(null);

  useEffect(() => {
    if (!container) return;
    let hiddenElement: HTMLElement | null = null;
    const sync = () => {
      editor.getEditorState().read(() => {
        const node = $getLeadingGoalCommand();
        const element = node ? editor.getElementByKey(node.getKey()) : null;
        if (hiddenElement && hiddenElement !== element)
          hiddenElement.style.removeProperty("display");
        hiddenElement = element;
        // 不能搬动 Lexical DOM；仅隐藏行内展示，保留选区、序列化及撤销的同一节点。
        if (element) element.style.display = "none";
        // React updater 可能延迟到 read 回调之后执行；节点读取必须先在 Lexical 上下文里完成。
        setGoalKey(node?.getKey() ?? null);
      });
    };
    const unregisterUpdate = editor.registerUpdateListener(sync);
    const unregisterRoot = editor.registerRootListener(sync);
    return () => {
      unregisterUpdate();
      unregisterRoot();
      hiddenElement?.style.removeProperty("display");
    };
  }, [container, editor]);

  if (!container || !goalKey) return null;
  const removeLabel = intl.formatMessage({ id: "chat.goalBanner.removeLabel" });
  return createPortal(
    <span data-testid="composer-goal-marker" className="flex items-center gap-1">
      <span role="separator" aria-orientation="vertical" className="h-3 w-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        data-composer-collapse-priority="2"
        aria-label={removeLabel}
        title={removeLabel}
        className="group/goal h-7 gap-1 rounded-lg px-1.5 text-ui-caption text-foreground-subtle data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          editor.update(
            () => {
              $removeLeadingGoalCommand(goalKey);
            },
            { tag: HISTORY_PUSH_TAG },
          );
          editor.focus();
        }}
      >
        <GoalIcon className="size-4 group-hover/goal:hidden" strokeWidth={1.5} />
        <XIcon className="hidden size-4 group-hover/goal:block" strokeWidth={1.5} />
        <span className="group-data-[composer-compact=true]/goal:hidden">
          {intl.formatMessage({ id: "chat.goalBanner.label" })}
        </span>
      </Button>
    </span>,
    container,
  );
}
