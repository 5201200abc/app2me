import { IconSquare } from "@tabler/icons-react";
import { interfaceIcon, type UiIconProps } from "@/components/icons/tablerContext.js";
import { PlusIcon, Minus } from "@/components/icons/tabler.js";

const SquareOutline = interfaceIcon(IconSquare);

/** 复用 Tabler 图形：圆角方框内上下加减，避免 FileDiff 的文件折角。 */
export function DiffIcon({ strokeWidth, ...props }: UiIconProps) {
  return (
    <SquareOutline {...props} strokeWidth={strokeWidth} data-diff-icon>
      <PlusIcon
        x={7}
        y={4}
        size={10}
        className="size-2.5"
        strokeWidth={strokeWidth}
        absoluteStrokeWidth
        aria-hidden
      />
      <Minus
        x={7}
        y={11}
        size={10}
        className="size-2.5"
        strokeWidth={strokeWidth}
        absoluteStrokeWidth
        aria-hidden
      />
    </SquareOutline>
  );
}
