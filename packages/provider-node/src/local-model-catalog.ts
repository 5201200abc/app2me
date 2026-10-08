import { createHash } from "node:crypto";
import {
  LOCAL_MODEL_PROVIDER_ID,
  parseMyCodeBuiltinModelConfigRules,
  type LocalModelScanResult,
  type ProviderConfigLayerSnapshot,
} from "@mycode/provider";

/** Host 和 CLI 使用同一文件事实投影；不把扫描名单写入个人配置。 */
export function withLocalModelCatalog(
  snapshot: ProviderConfigLayerSnapshot,
  scan: LocalModelScanResult,
): ProviderConfigLayerSnapshot {
  const local = snapshot.providers.get(LOCAL_MODEL_PROVIDER_ID);
  if (!local) return snapshot;
  const rules = snapshot.models.toMyCodeBuiltinJSON();
  const models = parseMyCodeBuiltinModelConfigRules({
    ...rules,
    builtinProviderModelRules: [
      ...rules.builtinProviderModelRules.filter(
        (rule) => rule.providerId !== LOCAL_MODEL_PROVIDER_ID,
      ),
      ...scan.models.map((model) => {
        const configuredWindow = snapshot.models.resolve({
          providerId: LOCAL_MODEL_PROVIDER_ID,
          modelId: model.id,
        }).properties?.contextWindow;
        // 原生上限纠正通用 500K；已配置的较小预算仍优先，避免误扩大推理预算。
        const contextWindow =
          model.contextWindow === undefined
            ? undefined
            : Math.min(model.contextWindow, configuredWindow ?? model.contextWindow);
        return {
          providerId: LOCAL_MODEL_PROVIDER_ID,
          modelId: model.id,
          config: {
            enabled: true,
            properties: {
              ...(contextWindow === undefined ? {} : { contextWindow }),
              inputFormat: {
                supportsText: true,
                supportsImage: model.vision,
                supportsVideo: false,
                supportsAudio: false,
                supportsPdf: false,
              },
              outputFormat: { supportsText: true },
              supportsToolCall: true,
              supportsJsonSchemaOutput: false,
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: false,
              requiresMfjsToolSchema: false,
            },
            optionSpecs: {
              maxOutputTokens: { max: 8192, map: '{"max_tokens": maxOutputTokens}' },
              reasoningLevel: { values: model.reasoningLevels, map: model.reasoningCelMap },
            },
          },
        };
      }),
    ],
  });
  const digest = createHash("sha256").update(JSON.stringify(scan)).digest("hex");
  return Object.freeze({
    ...snapshot,
    revision: `${snapshot.revision}:local:${digest}`,
    providers: snapshot.providers.set(
      LOCAL_MODEL_PROVIDER_ID,
      local.withBuiltinModelIds(scan.models.map((model) => model.id)),
    ),
    models,
  });
}
