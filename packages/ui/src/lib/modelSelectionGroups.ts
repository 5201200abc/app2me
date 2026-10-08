import { LOCAL_MODEL_PROVIDER_ID } from "@mycode/provider";
import { isMyCodeAgentProvider, type MyCodeProvider } from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/mycodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";
import { resolveModelFamilyLogo } from "@/lib/modelFamilyLogo.js";

function supportsRegistryApiFormat(
  selectedProvider: MyCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（MyCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isMyCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: MyCodeProvider,
  view: ModelSelectionView,
): ModelSelectGroup[] {
  return view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label:
          provider.providerId === LOCAL_MODEL_PROVIDER_ID
            ? "HuggingFace"
            : provider.providerName?.trim() || provider.providerId,
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          // 官方模型 ID 可跨版本复用；显示名来自同一 Registry，提交仍使用原 ID。
          name: config.properties?.displayName ?? modelId,
          logo: resolveModelFamilyLogo(modelId, provider.config.logo),
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}
