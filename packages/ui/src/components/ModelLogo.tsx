import type { ProviderConfigObject } from "@mycode/provider";
import { PackageIcon } from "@/components/icons/tabler.js";
import { cn } from "@/components/lib/utils.js";
import deepseek from "@/assets/model-icons/deepseek.svg";
import qwen from "@/assets/model-icons/qwen.svg";
import openai from "@/assets/model-icons/openai.svg";
import anthropic from "@/assets/model-icons/anthropic.svg";
import kimi from "@/assets/model-icons/kimi.svg";
import minimax from "@/assets/model-icons/minimax.svg";
import grok from "@/assets/model-icons/grok.svg";
import mimo from "@/assets/model-icons/xiaomimimo.svg";
import alibaba from "@/assets/model-icons/alibabacloud.svg";
import openrouter from "@/assets/model-icons/openrouter.svg";
import opencode from "@/assets/model-icons/opencode.svg";

import huggingface from "@/assets/model-icons/huggingface.svg";

const LOGOS: Readonly<Record<string, string>> = {
  huggingface,
  deepseek,
  qwen,
  openai,
  anthropic,
  minimax,
  openrouter,
  opencode,
  "moonshot-kimi": kimi,
  xai: grok,
  "xiaomi-mimo": mimo,
  "alibaba-model-studio": alibaba,
};

export function ModelLogo({
  logo,
  className,
}: {
  logo?: ProviderConfigObject["logo"];
  className?: string;
}) {
  const src = logo?.type === "builtin" ? LOGOS[logo.key] : undefined;
  if (!src)
    return <PackageIcon aria-hidden="true" data-model-logo className={cn("shrink-0", className)} />;
  // Vite 会内联小 SVG，data URL 内的引号会使无引号 url() 失效并露出方块底色。
  // 给 URL 加双引号，透明矢量遮罩只继承文字颜色，不显示品牌底色或方框。
  return (
    <span
      aria-hidden="true"
      data-model-logo
      className={cn("block shrink-0 bg-current", className)}
      style={{
        maskImage: `url("${src}")`,
        maskSize: "contain",
        maskPosition: "center",
        maskRepeat: "no-repeat",
      }}
    />
  );
}
