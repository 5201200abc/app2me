import { RotateCcwIcon } from "@/components/icons/tabler.js";
import { Button } from "@/components/ui/button.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
export function WorkflowResumeButton({ onResume }: { onResume: () => void }) {
  const { intl } = useMyCodeIntl();
  return (
    <Button
      className="ml-auto"
      data-testid="workflow-card-resume"
      onClick={onResume}
      size="sm"
      type="button"
      variant="outline"
    >
      <RotateCcwIcon className="size-3.5" />
      {intl.formatMessage({ id: "chat.toolCall.workflow.run.resume" })}
    </Button>
  );
}
