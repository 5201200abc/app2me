import {
  DEFAULT_MYCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  resolveDynamicWorkflowClientConfig,
} from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/provider";
import type {
  ICodingPlanSubscriptionService,
  OffPeakClientConfig,
} from "./codingPlanSubscription.js";

interface CodingPlanSubscriptionServiceDependencies {
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

function retiredSubscription<T>(): Promise<T> {
  // Bug 原因：历史 RPC 调用仍可进入购买服务。退役后在服务边界拒绝，防止触达官方支付接口。
  return Promise.reject(new Error("Coding Plan subscription integration has been removed"));
}

export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies = {},
): ICodingPlanSubscriptionService {
  return {
    batchPreview: () => retiredSubscription(),
    getStaticProducts: async () => ({}),
    getStaticTeamProducts: async () => ({}),
    getStartPlanPreview: async () => null,
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
    getModelContextBudgetStrategy: async () =>
      DEFAULT_MYCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
    productInfo: () => retiredSubscription(),
    preview: () => retiredSubscription(),
    createSign: () => retiredSubscription(),
    updateSign: () => retiredSubscription(),
    checkPayment: () => retiredSubscription(),
    checkPendingOrders: () => retiredSubscription(),
    queryStripeCards: () => retiredSubscription(),
    bindStripeCard: () => retiredSubscription(),
    unbindStripeCard: () => retiredSubscription(),
    payStripe: () => retiredSubscription(),
    checkPaypalSupport: () => retiredSubscription(),
    createPaypalSetupToken: () => retiredSubscription(),
    subscribePaypal: () => retiredSubscription(),
    getEnterprisePricing: async () => ({ productList: [] }),
    getEnterpriseBalance: () => retiredSubscription(),
    calculateEnterpriseOrder: () => retiredSubscription(),
    createEnterpriseOrder: () => retiredSubscription(),
    getEnterprisePendingOrders: () => retiredSubscription(),
    cancelEnterpriseOrder: () => retiredSubscription(),
    continueEnterpriseOrderPayment: () => retiredSubscription(),
    checkEnterpriseOrderStatus: () => retiredSubscription(),
  };
}

const EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 0,
  providers: Object.freeze([]),
});
