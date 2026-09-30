import { useEffect, useState } from "react";
import { LOCAL_MODEL_PROVIDER_ID } from "@mycode/provider";
import {
  BUILTIN_PROVIDER_TEMPLATE_IDS,
  TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON,
  TID_MODEL_PROVIDER_NAV_ITEM,
  isBuiltinModelProviderId,
  testId,
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
  const selected =
    available.find((provider) => provider.providerId === selectedId) ??
    available.find((provider) => provider.providerId === LOCAL_MODEL_PROVIDER_ID);
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
    <div className="relative min-w-0 space-y-4 p-4 sm:p-6">
      <ProviderDetailFeedbackBoundary>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui-sm text-foreground-subtle">{t("catalog")}</p>
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
        <div className="mt-4 flex min-w-0 flex-col gap-5 md:flex-row">
          <nav
            aria-label={t("catalog")}
            className="flex shrink-0 flex-wrap gap-1 md:w-44 md:flex-col"
          >
            {available.map((provider) => (
              <Button
                key={provider.providerId}
                variant={
                  selected?.providerId === provider.providerId && !picking ? "secondary" : "ghost"
                }
                className="h-auto justify-start whitespace-normal break-words text-left"
                data-testid={testId(TID_MODEL_PROVIDER_NAV_ITEM, provider.providerId)}
                aria-current={
                  selected?.providerId === provider.providerId && !picking ? "page" : undefined
                }
                onClick={() => {
                  setSelectedId(provider.providerId);
                  setPicking(false);
                }}
              >
                {provider.providerId === LOCAL_MODEL_PROVIDER_ID
                  ? t("title")
                  : provider.providerName || provider.templateId || "Provider"}
              </Button>
            ))}
          </nav>
          <main className="min-w-0 flex-1">
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
            ) : selected?.providerId === LOCAL_MODEL_PROVIDER_ID ? (
              <LocalModelsPanel
                key={selected.providerId}
                provider={selected}
                scan={local.scan}
                onSave={providers.saveProvider}
              />
            ) : selected ? (
              <InlineEditableProviderCard
                key={selected.providerId}
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
            ) : null}
          </main>
        </div>
      </ProviderDetailFeedbackBoundary>
    </div>
  );
}
