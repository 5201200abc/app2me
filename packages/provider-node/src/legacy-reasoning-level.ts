import {
  type ModelSelection,
  type ProviderRegistryServiceSnapshot,
} from "@mycode/provider";


/** 只为历史 Selection 恢复已知 Built-in 旧值域；不迁移 Personal 配置或在执行层放宽校验。 */
export function resolveLegacyReasoningLevel(
  snapshot: ProviderRegistryServiceSnapshot,
  selection: ModelSelection,
): string | undefined {
  const oldLevel = selection.options?.reasoningLevel;
  if (oldLevel === undefined) return undefined;
  const personal = snapshot.config.personalModels.getExactRule(
    selection.providerId,
    selection.modelId,
  );
  if (
    personal &&
    (personal.type === "manual-provider-model" ||
      personal.config.optionSpecs?.reasoningLevel?.values !== undefined ||
      personal.config.optionSpecs?.reasoningLevel?.map !== undefined)
  )
    return undefined;
  const provider = snapshot.resolution.effectiveProviders.get(selection.providerId);
  if (!provider) return undefined;
  // 旧目录只有 enabled；官方未指定 effort 时默认 high，不能恢复为最高档 max。
  // 兼容档位按官方映射，仅适用于当前 DeepSeek 模板且没有用户自定义思考配置。
  if (
    snapshot.resolution.effectiveProviders.getRule(selection.providerId)?.templateId ===
      "deepseek" &&
    (selection.modelId === "deepseek-flash" || selection.modelId === "deepseek-v4-pro")
  ) {
    const aliases: Readonly<Record<string, string>> = {
      enabled: "high",
      minimal: "low",
      medium: "high",
      xhigh: "high",
      ultra: "max",
      none: "disabled",
      off: "disabled",
    };
    const mapped = aliases[oldLevel];
    const values = snapshot.registry.providers
      .find((entry) => entry.providerId === selection.providerId)
      ?.models.find((model) => model.modelId === selection.modelId)?.config.optionSpecs
      .reasoningLevel.values;
    if (mapped && values?.includes(mapped)) return mapped;
  }
  return undefined;
}
