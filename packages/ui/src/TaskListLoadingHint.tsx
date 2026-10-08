import { Spinner } from "@/components/ui/spinner.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";

export function TaskListLoadingHint() {
  const { intl } = useMyCodeIntl();

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 text-ui-caption font-normal text-foreground-subtlest">
      <Spinner className="size-3.5 text-foreground-subtlest" />
      <span>{intl.formatMessage({ id: "taskList.loading" })}</span>
    </div>
  );
}
