import type { ProviderConfigObject } from "@mycode/provider";

type ProviderLogoRef = ProviderConfigObject["logo"];

const MODEL_FAMILY_LOGOS: readonly [RegExp, string][] = [
  [/(?:^|[/\s])deepseek/i, "deepseek"],
  [/(?:^|[/\s])qwen/i, "qwen"],
  [/(?:^|[/\s])claude/i, "anthropic"],
  [/(?:^|[/\s])(?:gpt-|o[134](?:-|$))/i, "openai"],
  [/(?:^|[/\s])kimi/i, "moonshot-kimi"],
  [/(?:^|[/\s])minimax/i, "minimax"],
  [/(?:^|[/\s])grok/i, "xai"],
  [/(?:^|[/\s])mimo/i, "xiaomi-mimo"],
];

export function resolveModelFamilyLogo(model: string, fallback: ProviderLogoRef): ProviderLogoRef {
  // 中转商的 Logo 不能覆盖模型身份；模型家族未知时仍尊重目录元数据。
  const matched = MODEL_FAMILY_LOGOS.find(([pattern]) => pattern.test(model));
  return matched ? { type: "builtin", key: matched[1] } : fallback;
}
