import { useId, type ReactNode } from "react";
import { AppWindow, Pointer2Icon } from "@/components/icons/tabler.js";
import "./settings-capability.css";

/** 能力开关共用行布局；Logo 是界面原生矢量，跟随主题与字号缩放。 */
export function SettingsCapabilityRow({
  kind,
  label,
  description,
  control,
  detail,
}: {
  kind: "computer" | "browser";
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  detail?: ReactNode;
}) {
  const gradientId = useId();
  return (
    <div className="settings-capability-row" data-settings-capability={kind}>
      <div
        className={`settings-capability-logo settings-capability-logo-${kind}`}
        aria-hidden="true"
      >
        {kind === "computer" ? (
          <svg viewBox="0 0 48 48" focusable="false">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--color-icon-blue)" />
                <stop offset="0.55" stopColor="var(--color-white)" />
                <stop offset="1" stopColor="var(--color-fuchsia-500)" />
              </linearGradient>
            </defs>
            <Pointer2Icon x="9" y="9" width="30" height="30" fill={`url(#${gradientId})`} />
          </svg>
        ) : (
          <>
            <AppWindow className="settings-capability-browser-window" />
            <Pointer2Icon className="settings-capability-browser-pointer" />
          </>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-ui-caption font-normal text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-ui-sm leading-relaxed text-foreground-subtle">
            {description}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
      {detail ? <div className="settings-capability-detail">{detail}</div> : null}
    </div>
  );
}
