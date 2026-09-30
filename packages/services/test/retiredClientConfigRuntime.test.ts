import assert from "node:assert/strict";
import test from "node:test";
import { createClientScenesService } from "../src/client-scenes/clientScenesService.js";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";

test("retired client scenes and runtime flags do not need an official API client", async () => {
  const service = createCodingPlanSubscriptionService();

  assert.deepEqual(await createClientScenesService().list(), {
    code: 0,
    msg: "",
    data: [],
  });
  assert.equal(typeof (await service.getDynamicWorkflowClientConfig()).enabled, "boolean");
  assert.equal((await service.getOffPeakClientConfig()).enabled, false);
  assert.deepEqual(await service.getStaticProducts(), {});
  assert.deepEqual(await service.getStaticTeamProducts(), {});
  assert.equal(await service.getStartPlanPreview(), null);
});

test("retired purchases cannot reach the official API client", async () => {
  const service = createCodingPlanSubscriptionService();

  assert.deepEqual(await service.getEnterprisePricing({ authenticated: true }), {
    productList: [],
  });
  const retiredCalls = [
    () => service.batchPreview(),
    () => service.productInfo({} as never),
    () => service.preview({} as never),
    () => service.createSign({} as never),
    () => service.updateSign({} as never),
    () => service.checkPayment({} as never),
    () => service.checkPendingOrders(),
    () => service.queryStripeCards(),
    () => service.bindStripeCard({} as never),
    () => service.unbindStripeCard({} as never),
    () => service.payStripe({} as never),
    () => service.checkPaypalSupport(),
    () => service.createPaypalSetupToken({} as never),
    () => service.subscribePaypal({} as never),
    () => service.getEnterpriseBalance(),
    () => service.calculateEnterpriseOrder({} as never),
    () => service.createEnterpriseOrder({} as never),
    () => service.getEnterprisePendingOrders(),
    () => service.cancelEnterpriseOrder({} as never),
    () => service.continueEnterpriseOrderPayment({} as never),
    () => service.checkEnterpriseOrderStatus({} as never),
  ];
  for (const call of retiredCalls) {
    await assert.rejects(call(), /Coding Plan subscription integration has been removed/);
  }
});
