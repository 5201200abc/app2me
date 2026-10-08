import type { MyCodeConfigOption } from "@mycode/shared";

const THOUGHT_STRENGTH_COLORS: Record<string, string> = {
  low: "#9CA3AF",
  medium: "#3B82F6",
  high: "#EAB308",
  xhigh: "#F97316",
  "extra-high": "#F97316",
  extra_high: "#F97316",
  max: "#DC2626",
};

/** 档位顺序由 Host 声明，滑杆只做离散索引投影，不创建 high 等别名。 */
export function resolveThoughtSlider(
  option: Pick<MyCodeConfigOption, "options" | "currentValue" | "defaultValue">,
) {
  const entries = option.options ?? [];
  const off = entries.find((entry) => entry.value === "disabled");
  const levels = entries.filter((entry) => entry !== off);
  const selectedIndex = levels.findIndex((entry) => entry.value === option.currentValue);
  return {
    off,
    levels,
    selectedIndex,
    // 颜色按原始等级语义派生；不能按槽位着色，否则 Qwen 三档会把 xhigh 误画成 High。
    color:
      selectedIndex < 0
        ? "#9CA3AF"
        : (THOUGHT_STRENGTH_COLORS[String(option.currentValue).trim().toLowerCase()] ??
          "var(--color-reasoning-accent)"),
    // DeepSeek 默认 high；恢复默认或重新开启不能无条件跳到最高档 max。
    defaultValue: entries.some((entry) => entry.value === option.defaultValue)
      ? option.defaultValue
      : entries.at(-1)?.value,
    enabled: selectedIndex >= 0,
    isToggle: levels.length <= 1,
  };
}
