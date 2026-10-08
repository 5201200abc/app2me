import type { MyCodeConfigOption } from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/services";

/** 从 Registry 的 ModelConfig Option Specs 读取思考档位。 */
export function resolveModelThoughtOption(params: {
  modelSelectionView: ModelSelectionView;
  providerId: string;
  modelId: string;
  currentValue?: string;
  formatLevelName?: (level: string) => string;
}): MyCodeConfigOption | null {
  const provider = params.modelSelectionView.providers.find(
    (candidate) => candidate.providerId === params.providerId,
  );
  const model = provider?.models.find((candidate) => candidate.modelId === params.modelId);
  const reasoning = model?.config.optionSpecs.reasoningLevel;
  if (!reasoning || reasoning.values.length === 0) return null;

  return {
    id: "thought_level",
    name: "Thought Level",
    category: "thought_level",
    type: "select",
    // 当前值不能从默认档位补齐；默认元数据仅用于用户主动恢复/开启思考。
    ...(reasoning.defaultValue ? { defaultValue: reasoning.defaultValue } : {}),
    currentValue:
      params.currentValue && reasoning.values.includes(params.currentValue)
        ? params.currentValue
        : "",
    options: reasoning.values.map((level) => ({
      value: level,
      name: params.formatLevelName?.(level) ?? level,
    })),
  };
}
