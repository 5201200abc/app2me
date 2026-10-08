import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { useEffect, useRef, useState } from "react";
import { DEEPSEEK_TEMPLATE_ID, LOCAL_MODEL_PROVIDER_ID } from "@mycode/provider";
import {
  BUILTIN_PROVIDER_TEMPLATE_IDS,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  isBuiltinModelProviderId,
} from "@mycode/shared";
import { Button } from "@/components/ui/button.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { useLocalModels } from "@/hooks/useLocalModels.js";
import {
  consumePendingSettingsModelProviderTarget,
  type SettingsModelProviderTarget,
} from "@/lib/settingsNavigation.js";
import { InlineEditableProviderCard } from "./model-provider-section/InlineEditableProviderCard.js";
import { LocalModelsPanel } from "./model-provider-section/LocalModelsPanel.js";
import { ProviderTemplatePicker } from "./model-provider-section/ProviderTemplatePicker.js";
import { ProviderDetailFeedbackBoundary } from "./model-provider-section/ProviderDetailFeedback.js";
import { ProviderLogo } from "./model-provider-section/ProviderLogo.js";

const RETIRED_PROVIDER_TEMPLATE_IDS = new Set<string>(Object.values(BUILTIN_PROVIDER_TEMPLATE_IDS));

/** 设置页始终使用注入的本地 Host，远程工作区不改变 ~/models 的文件所有者。 */
export function ModelProviderSection({
  workspacePath = "",
  connectivityWorkspacePath,
  connectivityWorkspaceRequired = false,
  pendingModelProviderTarget,
  onConsumePendingModelProviderTarget,
}: {
  workspacePath?: string;
  connectivityWorkspacePath?: string;
  connectivityWorkspaceRequired?: boolean;
  pendingModelProviderTarget?: SettingsModelProviderTarget;
  onConsumePendingModelProviderTarget?: () => void;
} = {}) {
  const { intl, locale } = useMyCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.localModels.${key}` });
  const providers = useModelProviders({
    workspacePath,
    connectivityWorkspacePath,
    connectivityWorkspaceRequired,
    connectivityUnavailableMessage: intl.formatMessage({
      id: "settings.modelProvider.testModel.localWorkspaceUnavailable",
    }),
  });
  const local = useLocalModels();
  const [selectedId, setSelectedId] = useState(
    () => consumePendingSettingsModelProviderTarget()?.providerId ?? LOCAL_MODEL_PROVIDER_ID,
  );
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pendingModelProviderTarget) return;
    setSelectedId(pendingModelProviderTarget.providerId);
    setPicking(false);
    onConsumePendingModelProviderTarget?.();
  }, [pendingModelProviderTarget, onConsumePendingModelProviderTarget]);
  const available = providers.modelProviders.filter(
    (provider) =>
      !isBuiltinModelProviderId(provider.providerId) &&
      !RETIRED_PROVIDER_TEMPLATE_IDS.has(provider.providerId) &&
      provider.providerId !== "builtin:zapi" &&
      !RETIRED_PROVIDER_TEMPLATE_IDS.has(provider.templateId ?? ""),
  );
  const selected = available.find((provider) => provider.providerId === selectedId) ?? available[0];
  useEffect(() => {
    // 深链与列表共用选中 ID，配置仍由供应商 hook 持有，不复制业务状态。
    if (!picking && !providers.loading) targetRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, picking, providers.loading, available.length]);
  const refresh = async () => {
    setError(null);
    try {
      await providers.refresh();
      await local.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="relative min-w-0 space-y-4" data-testid="model-provider-section">
      <ProviderDetailFeedbackBoundary>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={providers.refreshing || local.loading}
              onClick={() => void refresh()}
            >
              {t("refresh")}
            </Button>
            <Button
              size="sm"
              data-testid={TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON}
              onClick={() => setPicking(true)}
            >
              {intl.formatMessage({ id: "settings.modelProvider.addProviderAction" })}
            </Button>
          </div>
        </div>
        {(error || providers.loadError || local.error) && (
          <p role="alert" className="break-words text-ui-sm text-destructive">
            {error ?? providers.loadError?.message ?? local.error}
          </p>
        )}
        {providers.loading && (
          <p role="status" className="text-ui-sm">
            {intl.formatMessage({ id: "common.loading" })}
          </p>
        )}
        <div className="min-w-0 space-y-4">
          {picking ? (
            <ProviderTemplatePicker
              templates={providers.providerTemplates.filter(
                (template) => !RETIRED_PROVIDER_TEMPLATE_IDS.has(template.templateId),
              )}
              creating={creating}
              onBack={() => setPicking(false)}
              onCreateFromTemplate={async (templateId) => {
                setCreating(true);
                try {
                  const created = await providers.createPersonalProvider({ templateId, locale });
                  setSelectedId(created.providerId);
                  setPicking(false);
                } finally {
                  setCreating(false);
                }
              }}
            />
          ) : (
            <div className="grid min-w-0 gap-3 sm:grid-cols-[148px_minmax(0,1fr)]">
              <nav
                aria-label={intl.formatMessage({ id: "settings.modelProviderTitle" })}
                className="flex min-w-0 flex-wrap content-start gap-1 sm:flex-col"
              >
                {available.map((provider) => (
                  <Button
                    key={provider.providerId}
                    variant="ghost"
                    size="sm"
                    aria-pressed={provider.providerId === selected?.providerId}
                    className={`h-8 justify-start gap-2 px-2 text-ui-caption font-medium sm:w-full ${provider.providerId === selected?.providerId ? "bg-selected" : "text-foreground-subtle"}`}
                    onClick={() => setSelectedId(provider.providerId)}
                  >
                    <ProviderLogo
                      logo={
                        provider.providerId === LOCAL_MODEL_PROVIDER_ID
                          ? { type: "builtin", key: "huggingface" }
                          : provider.config.logo
                      }
                      className="size-5"
                    />
                    <span className="truncate">
                      {provider.providerId === LOCAL_MODEL_PROVIDER_ID
                        ? t("title")
                        : getProviderFormLabel(provider)}
                    </span>
                  </Button>
                ))}
              </nav>
              {selected && (
                <div
                  key={selected.providerId}
                  ref={targetRef}
                  data-provider-id={selected.providerId}
                  className={
                    selected.templateId === DEEPSEEK_TEMPLATE_ID
                      ? "min-w-0 px-3 py-2"
                      : "min-w-0 rounded-lg border border-border/50 bg-surface/20 p-3"
                  }
                >
                  {selected.providerId === LOCAL_MODEL_PROVIDER_ID ? (
                    <LocalModelsPanel
                      provider={selected}
                      scan={local.scan}
                      onSave={providers.saveProvider}
                    />
                  ) : (
                    <InlineEditableProviderCard
                      compactHeader={selected.templateId === DEEPSEEK_TEMPLATE_ID}
                      provider={selected}
                      onSave={async (provider) => {
                        await providers.saveProvider(provider);
                      }}
                      onAddPersonalModel={providers.addPersonalModel}
                      onSavePersonalModelDraft={providers.savePersonalModelDraft}
                      onSetPersonalModelEnabled={providers.setPersonalModelEnabled}
                      onDeletePersonalModel={providers.deletePersonalModel}
                      onDelete={() => providers.deleteProvider(selected.providerId)}
                      onTestModel={providers.testModelConnectivity}
                      onReorderModelIds={(ids) =>
                        providers.reorderProviderModels(selected.providerId, ids)
                      }
                      settingsRevision={providers.providerSettingsView?.revision}
                      nameEditable
                      readOnlyEndpoints
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </ProviderDetailFeedbackBoundary>
    </div>
  );
}
