import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalCodingPlanUpgradeDialog } from "@/settings/CodingPlanUpgradeDialogProvider.js";

export function useCodingPlanEntryGate() {
  const dialog = useOptionalCodingPlanUpgradeDialog();
  const { intl } = useMyCodeIntl();
  const status = dialog?.inventory?.status ?? "ready";
  const label =
    status === "ready"
      ? undefined
      : intl.formatMessage({
          id: status === "loading" ? "purchase.entry.loading" : "purchase.entry.retry",
        });
  return { status, label, retry: dialog?.inventory?.retry };
}

/** 隐藏所有商业化升级购买按钮 */
export function CodingPlanEntryButton(
  _props: ComponentProps<typeof Button> & { bypassGate?: boolean },
) {
  return null;
}
