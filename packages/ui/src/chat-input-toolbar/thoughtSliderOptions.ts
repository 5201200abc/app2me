import type { MyCodeConfigOption } from "@mycode/shared";

/** 档位顺序由 Host 声明，滑杆只做离散索引投影，不创建 high 等别名。 */
export function resolveThoughtSlider(option: Pick<MyCodeConfigOption, "options" | "currentValue">) {
  const entries = option.options ?? [];
  const off = entries.find((entry) => entry.value === "disabled");
  const levels = entries.filter((entry) => entry !== off);
  const selectedIndex = levels.findIndex((entry) => entry.value === option.currentValue);
  return {
    off,
    levels,
    selectedIndex,
    defaultValue: entries.at(-1)?.value,
    enabled: selectedIndex >= 0,
    isToggle: levels.length <= 1,
  };
}
