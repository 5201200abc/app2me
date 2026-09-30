import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileModelOptionMap } from "@mycode/model-option-map";
import { localModelReasoning } from "@mycode/provider";
import { decodeMyCodeBuiltinRelease } from "../src/mycode-builtin-release.js";
import { decodeProviderConfigFile } from "../src/provider-config-file-codec.js";

test("Qwen effort request bodies match the three official levels exactly", () => {
  const spec = localModelReasoning("Qwen3.8-27B");
  const map = compileModelOptionMap(spec.map, "reasoningLevel");
  assert.equal(spec.values.at(-1), "xhigh");
  for (const effort of ["low", "medium", "xhigh"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(map.evaluate(effort))), {
      reasoning_effort: effort,
      chat_template_kwargs: {
        enable_thinking: true,
        preserve_thinking: true,
        reasoning_effort: effort,
      },
    });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(map.evaluate("disabled"))), {
    chat_template_kwargs: { enable_thinking: false },
  });
  const toggle = compileModelOptionMap(localModelReasoning("Qwen3.5-27B").map, "reasoningLevel");
  for (const mode of ["enabled", "disabled"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(toggle.evaluate(mode))), {
      chat_template_kwargs: { enable_thinking: mode === "enabled" },
    });
  }
});

test("bundled catalogue exposes only DeepSeek creation and local models", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../../config/provider/mycode-builtin.json", import.meta.url),
      "utf8",
    ),
  );
  const release = decodeMyCodeBuiltinRelease(raw);
  assert.deepEqual(release.config.providerTemplates.keys(), ["deepseek"]);
  assert.deepEqual(release.config.providerTemplates.get("deepseek")?.config.builtinModelIds, [
    "deepseek-flash",
    "deepseek-v4-pro",
  ]);
  assert.deepEqual(release.config.providers.keys(), ["local-llama-models"]);
  raw.config.providerConfigRules.templateRules.push({
    ...raw.config.providerConfigRules.templateRules[0],
    templateId: "zai",
  });
  assert.throws(() => decodeMyCodeBuiltinRelease(raw), /退出|retired/i);
});

test("personal migration removes retired provider rules and stale defaults", () => {
  const result = decodeProviderConfigFile({
    schemaVersion: 1,
    config: {
      providerOrder: ["custom-old", "personal:deepseek"],
      providerConfigRules: {
        providerRules: [
          { providerId: "custom-old", config: { group: "standard-personal" } },
          {
            providerId: "personal:deepseek",
            templateId: "deepseek",
            config: {
              group: "standard-personal",
              access: { type: "api-key", apiKey: "fixture-key" },
            },
          },
        ],
      },
      modelConfigRules: {
        providerModelRules: [
          { providerId: "custom-old", modelId: "old-model", config: { enabled: true } },
        ],
        manualProviderModelRules: [],
      },
      defaultModelSelection: { providerId: "custom-old", modelId: "old-model" },
    },
  });
  assert.deepEqual(result.providers.keys(), ["personal:deepseek"]);
  assert.deepEqual(result.providerOrder, ["personal:deepseek"]);
  assert.equal(result.defaultModelSelection, undefined);
  assert.equal(result.models.toPersonalJSON().providerModelRules.length, 0);
});
