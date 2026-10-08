import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileModelOptionMap } from "@mycode/model-option-map";
import {
  completeNewModelSelection,
  serializeRegistryModelConfig,
  ModelConfig,
  EnumOptionSpecConfig,
  ProviderConfig,
  ApiKeyAccessConfig,
} from "@mycode/provider";
import { decodeMyCodeBuiltinRelease } from "../src/mycode-builtin-release.js";
import { NodeProviderRegistryRuntime } from "../src/provider-registry-runtime.js";
import { createNodeModelSelectionFacade } from "../src/model-selection-facade.js";
import { resolveLegacyReasoningLevel } from "../src/legacy-reasoning-level.js";

const bundled = fileURLToPath(
  new URL("../../../config/provider/mycode-builtin.json", import.meta.url),
);

test("DeepSeek catalogue matches official model IDs, modalities, limits and effort bodies", async () => {
  const release = decodeMyCodeBuiltinRelease(JSON.parse(await readFile(bundled, "utf8")));
  for (const modelId of ["deepseek-flash", "deepseek-v4-pro"]) {
    const config = release.config.modelConfigRules.resolve({
      providerId: "fixture",
      templateId: "deepseek",
      modelId,
    });
    assert.deepEqual(config.validateComplete(), []);
    const data = serializeRegistryModelConfig(
      config as Parameters<typeof serializeRegistryModelConfig>[0],
    );
    assert.equal(
      data.properties.displayName,
      modelId === "deepseek-flash" ? "DeepSeek-V4.1-Flash" : "DeepSeek-V4-Pro",
    );
    assert.equal(data.properties.contextWindow, 1_048_576);
    assert.equal(data.properties.inputFormat.supportsImage, modelId === "deepseek-flash");
    assert.equal(data.optionSpecs.maxOutputTokens.max, 393_216);
    const spec = data.optionSpecs.reasoningLevel;
    assert.deepEqual(spec.values, ["disabled", "low", "high", "max"]);
    assert.equal(spec.defaultValue, "high");
    const map = compileModelOptionMap(spec.map, "reasoningLevel");
    for (const effort of spec.values) {
      assert.deepEqual(JSON.parse(JSON.stringify(map.evaluate(effort))), {
        thinking: { type: effort === "disabled" ? "disabled" : "enabled" },
        reasoning_effort: effort === "disabled" ? "none" : effort,
      });
    }
    const registry = {
      providers: [{ providerId: "fixture", models: [{ modelId, config: data }] }],
    };
    assert.equal(
      completeNewModelSelection(registry, { providerId: "fixture", modelId })?.options
        ?.reasoningLevel,
      "high",
    );
  }
});

test("official default is validated while old models retain their highest-level default", () => {
  const invalid = new EnumOptionSpecConfig({
    values: ["low", "high"],
    map: '{"reasoning_effort": reasoningLevel}',
    defaultValue: "max",
  });
  assert.ok(invalid.validateComplete().some((issue) => issue.path.includes("defaultValue")));
  const inherited = new EnumOptionSpecConfig({
    values: ["low", "high", "max"],
    defaultValue: "high",
    map: '{"reasoning_effort": reasoningLevel}',
  });
  const custom = inherited.overlay(
    new EnumOptionSpecConfig({ values: ["custom-low", "custom-high"] }),
  );
  assert.equal(custom.defaultValue, undefined);
  assert.deepEqual(custom.validateComplete(), []);
  assert.equal(
    completeNewModelSelection(
      {
        providers: [
          {
            providerId: "local",
            models: [
              {
                modelId: "qwen",
                config: { optionSpecs: { reasoningLevel: { values: ["low", "xhigh"] } } },
              },
            ],
          },
        ],
      },
      { providerId: "local", modelId: "qwen" },
    )?.options?.reasoningLevel,
    "xhigh",
  );
});

test("revision 5 cache upgrades; legacy DeepSeek selections resolve without rewriting intent or custom rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepseek-alignment-"));
  const active = join(root, "active.json");
  const raw = JSON.parse(await readFile(bundled, "utf8"));
  raw.revision = 5;
  raw.config.modelConfigRules.templateModelRules.forEach((rule: { config: object }) => {
    rule.config = { enabled: true };
  });
  await writeFile(active, JSON.stringify(raw));
  const runtime = new NodeProviderRegistryRuntime({
    mycodeBuiltinFilePath: bundled,
    mycodeBuiltinActiveFilePath: active,
    personalFilePath: join(root, "personal.json"),
    watch: false,
    personalPollingIntervalMs: false,
  });
  try {
    const created = await runtime.configService.createPersonalProvider({
      templateId: "deepseek",
      initialConfig: new ProviderConfig({
        access: new ApiKeyAccessConfig({ apiKey: "fixture-key" }),
      }),
    });
    await runtime.start();
    const facade = createNodeModelSelectionFacade(runtime.registryService);
    for (const [old, expected] of Object.entries({
      enabled: "high",
      medium: "high",
      xhigh: "high",
      ultra: "max",
      minimal: "low",
      none: "disabled",
      off: "disabled",
    })) {
      const selection = {
        providerId: created.providerId,
        modelId: "deepseek-flash",
        options: { reasoningLevel: old },
      };
      assert.equal(
        facade.getView(undefined, undefined, { selection }).effectiveSelection?.options
          ?.reasoningLevel,
        expected,
      );
      assert.equal(selection.options.reasoningLevel, old);
    }
    assert.equal(JSON.parse(await readFile(active, "utf8")).revision, 6);
    const snapshot = runtime.registryService.getSnapshot()!;
    const rule = snapshot.resolution.effectiveProviders.getRule(created.providerId)!;
    const otherTemplate = {
      ...snapshot,
      resolution: {
        ...snapshot.resolution,
        effectiveProviders: snapshot.resolution.effectiveProviders.setRule({
          ...rule,
          templateId: null,
        }),
      },
    };
    assert.equal(
      resolveLegacyReasoningLevel(otherTemplate, {
        providerId: created.providerId,
        modelId: "deepseek-flash",
        options: { reasoningLevel: "medium" },
      }),
      undefined,
    );
    assert.equal(
      resolveLegacyReasoningLevel(snapshot, {
        providerId: created.providerId,
        modelId: "other-model",
        options: { reasoningLevel: "enabled" },
      }),
      undefined,
    );
    await runtime.personalRepository.update((current) => ({
      ...current,
      models: current.models.setExact(
        created.providerId,
        "deepseek-flash",
        ModelConfig.fromData({
          optionSpecs: {
            reasoningLevel: {
              values: ["low", "high", "max"],
              map: '{"custom_effort": reasoningLevel}',
            },
          },
        }),
      ),
    }));
    await runtime.registryService.refresh();
    assert.equal(
      facade.getView(undefined, undefined, {
        selection: {
          providerId: created.providerId,
          modelId: "deepseek-flash",
          options: { reasoningLevel: "enabled" },
        },
      }).selectionIssue,
      "reasoning-level-not-supported",
    );
  } finally {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
