import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLocalModels } from "../src/local-model-scanner.js";
import { isQwen38Model, localModelReasoning } from "@mycode/provider";

test("only Qwen3.8-27B and its GGUF variants receive the official effort levels", () => {
  for (const name of ["Qwen3.8-27B", "Qwen/Qwen3.8-27B", "Qwen3.8-27B-Uncensored-IQ2_M.gguf"]) {
    assert.equal(isQwen38Model(name), true, name);
    assert.deepEqual(localModelReasoning(name).values, ["disabled", "low", "medium", "xhigh"]);
  }
  for (const name of [
    "Qwen3-27B",
    "Qwen3.5-27B",
    "Qwen3.8-32B",
    "Qwen3.8-270B",
    "Gemma4",
    "Llama3",
  ]) {
    assert.equal(isQwen38Model(name), false, name);
    assert.deepEqual(localModelReasoning(name).values, ["disabled", "enabled"]);
  }
});

test("scanner excludes projectors and incomplete shards without collapsing quantizations", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-local-models-"));
  try {
    const dir = join(root, "Qwen3.8-27B");
    await mkdir(dir);
    for (const name of ["Qwen3.8-27B-Q4_K_M.gguf", "Qwen3.8-27B-Q8_0.gguf", "mmproj.gguf"]) {
      await writeFile(join(dir, name), "gguf");
    }
    await writeFile(join(root, "split-00001-of-00002.gguf"), "gguf");
    await writeFile(join(root, "broken-00001-of-00002.gguf"), "gguf");
    await writeFile(join(root, "split-00002-of-00002.gguf"), "gguf");
    await symlink(root, join(dir, "loop"), "dir");
    const result = await discoverLocalModels(root);
    assert.equal(result.models.length, 3);
    assert.equal(new Set(result.models.map((model) => model.id)).size, 3);
    assert.equal(result.models.filter((model) => model.vision).length, 2);
    assert.deepEqual(
      result.models
        .filter((model) => model.reasoningControl === "effort")
        .map((model) => model.contextWindow),
      [262_144, 262_144],
    );
    assert.equal(result.models.find((model) => model.id === "split")?.sizeBytes, 8);
    assert.equal(result.models.find((model) => model.id === "split")?.contextWindow, undefined);
    assert.ok(result.warnings.some((warning) => warning.includes("broken")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing model directory is distinguishable from an empty one", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-local-empty-"));
  try {
    assert.equal((await discoverLocalModels(root)).directoryExists, true);
    assert.equal((await discoverLocalModels(join(root, "missing"))).directoryExists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Qwen directory name cannot grant three effort levels to a different model", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-model-identity-"));
  try {
    const dir = join(root, "Qwen3.8-27B");
    await mkdir(dir);
    await writeFile(join(dir, "Llama3-Q4_K_M.gguf"), "GGUF");
    assert.deepEqual((await discoverLocalModels(root)).models[0]?.reasoningLevels, [
      "disabled",
      "enabled",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
