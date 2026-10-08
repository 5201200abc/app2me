import type { ReactNode } from "react";

/** 能力页共享两行页头；操作不放进空列表分支，搜索无结果时仍可使用。 */
export function SettingsResourcePageHeader({
  title,
  description,
  actions,
  filters,
}: {
  title: string;
  description?: string;
  actions: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <header data-settings-resource-page-header className="space-y-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h3 className="text-ui-xl font-normal text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-ui-caption font-normal text-foreground-subtle">{description}</p>
          ) : null}
        </div>
        <div data-settings-resource-page-actions className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      </div>
      {filters}
    </header>
  );
}
