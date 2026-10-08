import assert from "node:assert/strict";
import test from "node:test";
import { providerAccessDataSchema } from "../src/config/provider-data-schema.js";
import { parseAccountProviderConfigMap } from "../src/config/schema.js";
import { MODEL_PROVIDER_FAMILY_SPECS } from "@mycode/shared";

test("removed account access is rejected while personal API keys remain supported", () => {
  for (const type of ["legacy-account", "legacy-coding-plan-api-key"]) {
    assert.equal(providerAccessDataSchema.safeParse({ type }).success, false);
  }
  assert.equal(
    providerAccessDataSchema.safeParse({ type: "api-key", apiKey: "test" }).success,
    true,
  );
  assert.throws(() => parseAccountProviderConfigMap({ "legacy-account": {} }), /removed/);
  assert.deepEqual([...parseAccountProviderConfigMap({}).entries()], []);
  assert.deepEqual(MODEL_PROVIDER_FAMILY_SPECS, []);
});
