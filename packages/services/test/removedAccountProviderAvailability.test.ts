import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBigModelAccountProviderAvailability,
  validateZaiAccountProviderAvailability,
} from "../src/model-provider/codingPlanProviderAvailability.js";

test("历史账号可用性只返回未连接且不读取外部依赖", async () => {
  const providers = [
    { providerId: "old-zai", family: "zai", planKind: "individual-coding-plan" },
    { providerId: "old-bigmodel", family: "bigmodel", planKind: "team-coding-plan" },
  ] as const;
  const unavailable = { kind: "unavailable", reason: "coding_plan_not_connected" };
  const forbiddenContext = new Proxy({}, {
    get() {
      throw new Error("旧官方依赖被读取");
    },
  });

  assert.deepEqual(await validateZaiAccountProviderAvailability(providers, forbiddenContext), {
    "old-zai": unavailable,
  });
  assert.deepEqual(await validateBigModelAccountProviderAvailability(providers, forbiddenContext), {
    "old-bigmodel": unavailable,
  });
});
