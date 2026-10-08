import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { UiIconProps } from "@/components/icons/tabler.js";
import "./process-row.css";

/** 只统一展示列；展开状态和事件仍由原行组件维护。 */
export function ProcessRowContent({
  icon,
  showIcon: _showIcon = true,
  iconClassName,
  children,
}: {
  icon: ReactNode;
  showIcon?: boolean;
  iconClassName?: string;
  children: ReactNode;
}) {
  return (
    <>
      <span data-process-icon aria-hidden className={iconClassName}>
        {isValidElement(icon)
          ? cloneElement(icon as ReactElement<UiIconProps>, {
              size: "1em",
              strokeWidth: 1.5,
              stroke: undefined,
              absoluteStrokeWidth: false,
            })
          : icon}
      </span>
      <span data-process-copy>{children}</span>
    </>
  );
}
