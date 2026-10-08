import type { DynamicWorkflowClientConfig, MyCodeModelContextBudgetStrategy } from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/provider";
import { ServiceChannels } from "@mycode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OffPeakClientConfig {
  readonly enabled: boolean;
  readonly modelSelectionView: ModelSelectionView;
  readonly codingPlanActive?: boolean;
}

export interface IRuntimeConfigService {
  getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig>;
  getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig>;
  getModelContextBudgetStrategy(): Promise<MyCodeModelContextBudgetStrategy>;
}

export const IRuntimeConfigService = createServiceDescriptor<IRuntimeConfigService>(
  ServiceChannels.RuntimeConfig,
);
