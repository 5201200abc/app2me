import { Badge } from "@/components/ui/badge.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";

export function SettingsScopeBadge({
  scope,
  label,
  includeMcpTestAttribute = false,
}: {
  scope: "default" | "user" | "workspace";
  label?: string;
  includeMcpTestAttribute?: boolean;
}) {
  const { intl } = useMyCodeIntl();
  return (
    <Badge
      variant="secondary"
      className="rounded-md border-border/50 bg-surface/40 px-1.5 py-0.5 text-ui-sm font-normal"
      data-settings-scope={scope}
      data-mcp-scope={includeMcpTestAttribute ? scope : undefined}
    >
      {label ?? intl.formatMessage({ id: `settings.scope.${scope}` })}
    </Badge>
  );
}
