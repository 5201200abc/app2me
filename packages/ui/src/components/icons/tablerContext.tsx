import type { IconProps, TablerIcon } from "@tabler/icons-react";
import {
  createContext,
  forwardRef,
  useContext,
  type ReactNode,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from "react";

export type UiIconProps = IconProps & { absoluteStrokeWidth?: boolean };
export type UiIcon = ForwardRefExoticComponent<UiIconProps & RefAttributes<SVGSVGElement>>;
const IconStrokeContext = createContext(2);

export function IconProvider({
  children,
  strokeWidth = 2,
}: {
  children: ReactNode;
  strokeWidth?: number;
}) {
  return <IconStrokeContext.Provider value={strokeWidth}>{children}</IconStrokeContext.Provider>;
}

/** 只适配既有语义名称和 SVG 属性；图形完整来自 Tabler 官方组件，不改写 path。 */
export function interfaceIcon(Icon: TablerIcon): UiIcon {
  const Component = forwardRef<SVGSVGElement, UiIconProps>(function InterfaceIcon(
    { size = 24, strokeWidth, stroke, absoluteStrokeWidth, ...props },
    ref,
  ) {
    const inheritedStroke = useContext(IconStrokeContext);
    const lineWidth = strokeWidth ?? stroke ?? inheritedStroke;
    const resolvedStroke =
      absoluteStrokeWidth && typeof lineWidth === "number" && typeof size === "number" && size > 0
        ? (lineWidth * 24) / size
        : lineWidth;
    return <Icon ref={ref} size={size} stroke={resolvedStroke} {...props} />;
  });
  Component.displayName = Icon.displayName;
  return Component;
}
