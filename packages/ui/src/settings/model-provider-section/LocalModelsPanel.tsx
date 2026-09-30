import { useState } from "react";
import type { LocalModelScanResult } from "@mycode/provider";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import {
  getProviderFormApiKey,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";

export function LocalModelsPanel({
  provider,
  scan,
  onSave,
}: {
  provider: ProviderSettingsFormProvider;
  scan: LocalModelScanResult | null;
  onSave: (provider: ProviderSettingsFormProvider) => Promise<unknown>;
}) {
  const { intl } = useMyCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.localModels.${key}` });
  const [address, setAddress] = useState(
    provider.config.api?.baseUrl ?? "http://127.0.0.1:8080/v1",
  );
  const [apiKey, setApiKey] = useState(getProviderFormApiKey(provider));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const parsed = new URL(address.trim());
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error(t("invalidUrl"));
      await onSave({
        ...provider,
        personalConfig: {
          ...provider.personalConfig,
          api: { type: "openai-chat-completions", baseUrl: parsed.href.replace(/\/$/, "") },
          access: { type: "api-key", apiKey: apiKey.trim() || "local" },
        },
      });
      setFeedback(t("saved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="min-w-0 space-y-5" data-testid="local-models-panel">
      <div>
        <h2 className="text-ui-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-ui-sm text-foreground-subtle">{t("description")}</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-1 text-ui-sm">
          <span>{t("address")}</span>
          <Input
            aria-label={t("address")}
            value={address}
            disabled={saving}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://127.0.0.1:8080/v1"
          />
        </label>
        <label className="block space-y-1 text-ui-sm">
          <span>{t("key")}</span>
          <Input
            aria-label={t("key")}
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={saving}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={saving}>
          {t(saving ? "saving" : "save")}
        </Button>
        {feedback && (
          <p className="break-words text-ui-sm" role="status">
            {feedback}
          </p>
        )}
      </form>
      <div className="space-y-3">
        <p className="break-all text-ui-sm text-foreground-subtle">
          {t("directory")}: {scan?.modelsDir ?? "~/models"}
        </p>
        {scan && !scan.directoryExists && (
          <p role="status" className="text-ui-sm">
            {t("missing")}
          </p>
        )}
        {scan?.directoryExists && scan.models.length === 0 && (
          <p role="status" className="text-ui-sm">
            {t("empty")}
          </p>
        )}
        {scan?.warnings.map((warning) => (
          <p key={warning} role="alert" className="break-all text-ui-sm text-foreground-subtle">
            {warning}
          </p>
        ))}
        {scan?.models.map((model) => (
          <article
            key={model.id}
            className="space-y-2 rounded-lg border border-border bg-surface p-4"
            data-testid="local-model-item"
          >
            <h3 className="break-all text-ui-base font-medium">{model.name}</h3>
            <p className="break-all text-ui-xs text-foreground-subtle">{model.path}</p>
            <p className="text-ui-sm">
              {(model.sizeBytes / 1024 ** 3).toFixed(2)} GiB
              {model.vision ? ` · ${t("vision")}` : ""}
            </p>
            <p className="text-ui-sm">
              {model.reasoningControl === "effort" ? t("efforts") : t("toggle")}
            </p>
            <p className="break-all text-ui-xs text-foreground-subtle">
              {t("modelId")}: {model.id}
            </p>
          </article>
        ))}
        <p className="text-ui-sm text-foreground-subtle">{t("serverHint")}</p>
      </div>
    </section>
  );
}
