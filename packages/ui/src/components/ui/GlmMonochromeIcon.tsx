import type { ImgHTMLAttributes } from "react";
import brandMark from "@/assets/mycode-mark.png";
import { cn } from "@/components/lib/utils.js";
import { useMyCodeStore } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";

type GlmMonochromeIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function GlmMonochromeIcon({
  className,
  alt = "",
  style,
  ...props
}: GlmMonochromeIconProps) {
  const theme = useMyCodeStore((state) => state.theme);
  const isDark = resolveTheme(theme) === "dark";
  // glm 是运行时 provider 的协议标识；应用图标统一使用新的 mycode 徽标。
  const filter = isDark
    ? "grayscale(1) brightness(1.9) contrast(0.8)"
    : "grayscale(1) brightness(0.74) contrast(1.05)";

  return (
    <img
      src={brandMark}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={cn("shrink-0 object-contain", className)}
      style={{ filter, ...style }}
      {...props}
    />
  );
}
