import type { MyCodeProvider } from "@mycode/shared";
import { GlmMonochromeIcon } from "@/components/ui/GlmMonochromeIcon.js";

export function renderProviderCliIcon(_provider: MyCodeProvider = "glm", className?: string) {
  // 协议继续使用 glm 标识，应用展示统一使用 mycode 品牌图标。
  return <GlmMonochromeIcon className={className} />;
}
