import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LOCAL_MODEL_PROVIDER_ID, ProviderConfigService, ModelConfig } from "@mycode/provider";
import { NodeMyCodeBuiltinProviderConfigSource } from "../src/mycode-builtin-provider-config-source.js";
import { NodePersonalProviderConfigRepository } from "../src/personal-provider-config-repository.js";
import { decodeProviderConfigFile } from "../src/provider-config-file-codec.js";

const bundled = fileURLToPath(
  new URL("../../../config/provider/mycode-builtin.json", import.meta.url),
);

test("source rejects retired LKG, publishes complete local models, refreshes membership and supports only DeepSeek creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-catalog-"));
  const models = join(root, "models");
  await mkdir(models);
  const active = join(root, "active.json");
  const retired = JSON.parse(await readFile(bundled, "utf8"));
  retired.revision = 999;
  retired.config.providerConfigRules.providerRules[0].providerId = "retired-custom";
  await writeFile(active, JSON.stringify(retired));
  const source = new NodeMyCodeBuiltinProviderConfigSource({
    bundledFilePath: bundled,
    activeFilePath: active,
    localModelsDirectory: models,
    watch: false,
  });
  const repo = new NodePersonalProviderConfigRepository({
    filePath: join(root, "personal.json"),
    pollingIntervalMs: false,
  });
  const service = new ProviderConfigService({
    mycodeBuiltinSource: source,
    personalRepository: repo,
  });
  try {
    const empty = await source.read();
    assert.deepEqual(empty.providers.keys(), [LOCAL_MODEL_PROVIDER_ID]);
    assert.deepEqual(empty.providers.get(LOCAL_MODEL_PROVIDER_ID)?.builtinModelIds, []);
    await writeFile(join(models, "Qwen3.8-27B-Q4_K_M.gguf"), "GGUF");
    const populated = await source.read();
    assert.notEqual(empty.revision, populated.revision);
    assert.equal((await source.read()).revision, populated.revision);
    const modelId = populated.providers.get(LOCAL_MODEL_PROVIDER_ID)!.builtinModelIds![0]!;
    const config = populated.models.resolve({ providerId: LOCAL_MODEL_PROVIDER_ID, modelId });
    assert.deepEqual(config.validateComplete(), []);
    assert.deepEqual(config.toJSON().optionSpecs?.reasoningLevel?.values, [
      "disabled",
      "low",
      "medium",
      "xhigh",
    ]);
    await assert.rejects(service.createPersonalProvider(), /仅支持/);
    await assert.rejects(service.createPersonalProvider({ templateId: "retired-template" }), /仅支持/);
    const created = await service.createPersonalProvider({ templateId: "deepseek" });
    assert.equal((await repo.read()).providers.getRule(created.providerId)?.templateId, "deepseek");
    await assert.rejects(
      service.addPersonalModel(LOCAL_MODEL_PROVIDER_ID, "phantom", ModelConfig.empty()),
      /自动发现/,
    );
    await rm(join(models, "Qwen3.8-27B-Q4_K_M.gguf"));
    assert.deepEqual(
      (await source.read()).providers.get(LOCAL_MODEL_PROVIDER_ID)?.builtinModelIds,
      [],
    );
  } finally {
    service.dispose();
    source.dispose();
    repo.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("migration keeps the local connection but discards hand-written model membership and effort overrides", () => {
  const result = decodeProviderConfigFile({
    schemaVersion: 1,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: "custom-qwen",
            providerName: "Local Qwen",
            config: {
              group: "standard-personal",
              api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:9080/v1" },
              personalModelIds: ["phantom"],
            },
          },
        ],
      },
      modelConfigRules: {
        providerModelRules: [
          { providerId: "custom-qwen", modelId: "phantom", config: { enabled: true } },
        ],
        manualProviderModelRules: [],
      },
    },
  });
  assert.deepEqual(result.providers.keys(), [LOCAL_MODEL_PROVIDER_ID]);
  assert.equal(
    result.providers.get(LOCAL_MODEL_PROVIDER_ID)?.api?.baseUrl,
    "http://127.0.0.1:9080/v1",
  );
  assert.equal(result.providers.get(LOCAL_MODEL_PROVIDER_ID)?.personalModelIds, undefined);
  assert.deepEqual(result.models.toPersonalJSON().providerModelRules, []);
});
