import {
  DEFAULT_MYCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  resolveDynamicWorkflowClientConfig,
} from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/provider";
import type { IRuntimeConfigService, OffPeakClientConfig } from "./runtimeConfig.js";

interface RuntimeConfigServiceDependencies {
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

const EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW: ModelSelectionView = { revision: 0, providers: [] };

export function createRuntimeConfigService(
  dependencies: RuntimeConfigServiceDependencies = {},
): IRuntimeConfigService {
  return {
    getOffPeakClientConfig: async (): Promise<OffPeakClientConfig> => {
      const modelSelectionView =
        (await dependencies.resolveOffPeakModelSelectionView?.()) ??
        EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW;
      const hasModels = modelSelectionView.providers.some((provider) => provider.models.length > 0);
      if (process.env["MYCODE_OFFPEAK_MOCK"] === "1") {
        return {
          enabled: hasModels,
          modelSelectionView,
          codingPlanActive: process.env["MYCODE_OFFPEAK_MOCK_NO_PLAN"] !== "1",
        };
      }
      return { enabled: false, modelSelectionView };
    },
    getDynamicWorkflowClientConfig: async () =>
      resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env }),
    getModelContextBudgetStrategy: async () => DEFAULT_MYCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  };
}
