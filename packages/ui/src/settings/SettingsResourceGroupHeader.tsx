interface SettingsResourceGroupHeaderProps {
  hint?: string;
  title: string;
}

export function SettingsResourceGroupHeader({ hint, title }: SettingsResourceGroupHeaderProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-ui-caption font-medium text-foreground">{title}</span>
      </div>
      {hint ? <div className="min-w-0 text-ui-caption text-foreground-subtle">{hint}</div> : null}
    </div>
  );
}
