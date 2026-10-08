import assert from "node:assert/strict";
import test from "node:test";
import { createClientScenesService } from "../src/client-scenes/clientScenesService.js";
import { createRuntimeConfigService } from "../src/runtime-config/runtimeConfigService.js";

test("local runtime configuration has no purchasing API", async () => {
  const service = createRuntimeConfigService();
  assert.deepEqual(Object.keys(service).sort(), [
    "getDynamicWorkflowClientConfig",
    "getModelContextBudgetStrategy",
    "getOffPeakClientConfig",
  ]);
  assert.deepEqual(await createClientScenesService().list(), { code: 0, msg: "", data: [] });
  assert.equal(typeof (await service.getDynamicWorkflowClientConfig()).enabled, "boolean");
  assert.equal((await service.getOffPeakClientConfig()).enabled, false);
  assert.ok(await service.getModelContextBudgetStrategy());
});
