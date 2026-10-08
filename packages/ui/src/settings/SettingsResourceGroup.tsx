import type { ReactNode } from "react";

export function SettingsResourceGroupHeader({
  actions,
  title,
}: {
  actions?: ReactNode;
  title: string;
}) {
  const heading = (
    <h3 className="flex h-7 items-center gap-1.5 text-ui-caption font-medium text-foreground">
      {title}
    </h3>
  );
  return actions ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {heading}
      {actions}
    </div>
  ) : (
    heading
  );
}

export function SettingsResourceList<T>({
  getKey,
  items,
  renderItem,
}: {
  getKey: (item: T) => string;
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg bg-surface/60">
      {items.map((item, index) => (
        <div key={getKey(item)}>
          {index > 0 ? <div className="h-px bg-border/50" aria-hidden="true" /> : null}
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
