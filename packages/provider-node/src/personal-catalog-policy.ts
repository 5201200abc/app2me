import {
  DEEPSEEK_TEMPLATE_ID,
  LOCAL_MODEL_PROVIDER_ID,
  ProviderConfig,
  ProviderConfigMap,
  parsePersonalModelConfigRules,
  type ProviderConfigLayerUpdate,
  type ProviderConfigRule,
} from "@mycode/provider";

/** 文件读取和原子写入共用迁移，防止旧配置把退役供应商及错误思考映射重新发布。 */
export function normalizePersonalCatalog(
  input: ProviderConfigLayerUpdate,
): ProviderConfigLayerUpdate {
  const rules: ProviderConfigRule[] = [];
  const canonicalLocal = input.providers.getRule(LOCAL_MODEL_PROVIDER_ID);
  const legacyLocal = input.providers.rules().find((rule) => {
    const api = rule.config.api;
    if (api?.type !== "openai-chat-completions" || !api.baseUrl) return false;
    try {
      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(api.baseUrl).hostname);
    } catch {
      return false;
    }
  });
  const local = canonicalLocal ?? legacyLocal;
  if (local) {
    // 本地成员、能力和思考档位只属于扫描结果；个人层只保留连接设置与启停。
    rules.push({
      providerId: LOCAL_MODEL_PROVIDER_ID,
      enabled: local.enabled,
      config: new ProviderConfig({ api: local.config.api, access: local.config.access }),
    });
  }
  for (const rule of input.providers.rules()) {
    if (rule.providerId === LOCAL_MODEL_PROVIDER_ID || rule === legacyLocal) continue;
    let deepseek = rule.templateId === DEEPSEEK_TEMPLATE_ID;
    try {
      deepseek ||= new URL(rule.config.api?.baseUrl ?? "").hostname === "api.deepseek.com";
    } catch {
      /* 没有显式地址的模板实例由 templateId 判定。 */
    }
    if (deepseek) rules.push({ ...rule, templateId: DEEPSEEK_TEMPLATE_ID });
  }
  const providers = new ProviderConfigMap(rules);
  const allowed = (id: string) => providers.has(id) || id === LOCAL_MODEL_PROVIDER_ID;
  const models = input.models.toPersonalJSON();
  const selection = input.defaultModelSelection;
  return {
    providers,
    models: parsePersonalModelConfigRules({
      providerModelRules: models.providerModelRules
        .filter((rule) => allowed(rule.providerId))
        .map((rule) =>
          rule.providerId === LOCAL_MODEL_PROVIDER_ID
            ? { ...rule, config: { enabled: rule.config.enabled } }
            : rule,
        ),
      manualProviderModelRules: models.manualProviderModelRules.filter(
        (rule) => allowed(rule.providerId) && rule.providerId !== LOCAL_MODEL_PROVIDER_ID,
      ),
    }),
    providerOrder: input.providerOrder?.filter(allowed),
    ...(selection && allowed(selection.providerId) ? { defaultModelSelection: selection } : {}),
  };
}
