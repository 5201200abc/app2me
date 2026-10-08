import { ListTodoIcon } from "@/components/icons/tabler.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

export function WorkspaceSummaryToggleButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { intl } = useMyCodeIntl();
  const label = intl.formatMessage({ id: "chat.summaryPanel.togglePinnedSummary" });
  return (
    <ControlHintTooltip title={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        data-testid="workspace-summary-toggle"
        aria-label={label}
        aria-pressed={expanded}
        className={cn(
          "rounded-md border hover:text-foreground [app-region:no-drag]",
          expanded
            ? "border-border-hover bg-surface-hover text-foreground"
            : "border-transparent text-foreground-subtle",
        )}
        onClick={onToggle}
      >
        <ListTodoIcon aria-hidden className="size-3.5" />
      </Button>
    </ControlHintTooltip>
  );
}
