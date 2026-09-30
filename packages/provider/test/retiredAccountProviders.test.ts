import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiKeyAccessConfig,
  ModelConfigRules,
  ProviderConfig,
  ProviderConfigMap,
  ZhipuAccountAccessConfig,
} from "../src/config/index.js";
import { ProviderConfigResolver } from "../src/resolver.js";

test("historical Zhipu account providers stay out of the model catalog", () => {
  const resolution = new ProviderConfigResolver().resolve({
    mycodeBuiltinProviders: ProviderConfigMap.empty(),
    personalProviders: new ProviderConfigMap([
      [
        "legacy-account",
        new ProviderConfig({
          access: new ZhipuAccountAccessConfig({
            accountType: "zai",
            mode: "individual-coding-plan",
            entitled: true,
          }),
        }),
      ],
      ["custom-api", new ProviderConfig({ access: new ApiKeyAccessConfig({ apiKey: "test" }) })],
    ]),
    mycodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels: ModelConfigRules.empty(),
    accountProviders: ProviderConfigMap.empty(),
  });

  assert.deepEqual(
    resolution.resolvedProviders.map((provider) => provider.providerId),
    ["custom-api"],
  );
});
