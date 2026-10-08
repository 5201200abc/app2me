import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LOCAL_MODEL_PROVIDER_ID } from "@mycode/provider";
import { NodeMyCodeBuiltinProviderConfigSource } from "../src/mycode-builtin-provider-config-source.js";

const bundled = fileURLToPath(
  new URL("../../../config/provider/mycode-builtin.json", import.meta.url),
);

test("bundled release upgrades 32K cache, applies Qwen native capacity and DeepSeek capacity", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-context-"));
  const models = join(root, "models");
  const active = join(root, "active.json");
  const source = new NodeMyCodeBuiltinProviderConfigSource({
    bundledFilePath: bundled,
    activeFilePath: active,
    localModelsDirectory: models,
    watch: false,
  });
  try {
    await mkdir(models);
    await writeFile(join(models, "Qwen3.8-27B-Q4_K_M.gguf"), "GGUF");
    const oldRelease = JSON.parse(await readFile(bundled, "utf8"));
    oldRelease.revision = 4;
    oldRelease.config.modelConfigRules.modelRules[0].config.properties.contextWindow = 32_768;
    await writeFile(active, JSON.stringify(oldRelease));
    const snapshot = await source.read();
    const modelId = snapshot.providers.get(LOCAL_MODEL_PROVIDER_ID)!.builtinModelIds![0]!;
    const local = snapshot.models.resolve({ providerId: LOCAL_MODEL_PROVIDER_ID, modelId });
    assert.deepEqual(local.validateComplete(), []);
    assert.equal(local.properties.contextWindow, 262_144);
    assert.equal(local.optionSpecs.maxOutputTokens.max, 8_192);
    const template = snapshot.models.resolve({
      templateId: "deepseek",
      modelId: "deepseek-flash",
    });
    assert.equal(template.properties.contextWindow, 1_048_576);
    assert.equal(template.optionSpecs.maxOutputTokens.max, 393_216);
    const persisted = JSON.parse(await readFile(active, "utf8"));
    assert.equal(persisted.revision, 6);
    assert.equal(
      persisted.config.modelConfigRules.modelRules[0].config.properties.contextWindow,
      500_000,
    );
    assert.equal((await source.read()).revision, snapshot.revision);
  } finally {
    source.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("local catalog inherits an explicit smaller release window without inflating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-context-override-"));
  const models = join(root, "models");
  const customBundled = join(root, "bundled.json");
  const source = new NodeMyCodeBuiltinProviderConfigSource({
    bundledFilePath: customBundled,
    localModelsDirectory: models,
    watch: false,
  });
  try {
    await mkdir(models);
    await writeFile(join(models, "Qwen3.8-27B-Q4_K_M.gguf"), "GGUF");
    const release = JSON.parse(await readFile(bundled, "utf8"));
    release.config.modelConfigRules.modelRules[0].config.properties.contextWindow = 64_000;
    await writeFile(customBundled, JSON.stringify(release));
    const snapshot = await source.read();
    const modelId = snapshot.providers.get(LOCAL_MODEL_PROVIDER_ID)!.builtinModelIds![0]!;
    assert.equal(
      snapshot.models.resolve({ providerId: LOCAL_MODEL_PROVIDER_ID, modelId }).properties
        .contextWindow,
      64_000,
    );
  } finally {
    source.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
