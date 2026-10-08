import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readLicenseEmbeddedReviews } from "../scripts/license-embedded-reviews.mjs";
import { wasmProducerSection } from "../scripts/license-wasm-producers.mjs";

const repository = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "app2me-embedded-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const components = await readJson(join(repository, "third-party/embedded-components.json"));
  const { rawInputs } = await readLicenseEmbeddedReviews(repository, components);
  for (const path of [
    ...Object.keys(rawInputs),
    "third-party/publisher-reviews.json",
    "third-party/embedded-reviews.json",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(join(repository, path), join(root, path));
  }
  const manifest = await readJson(join(root, "third-party/embedded-reviews.json"));
  const save = () =>
    writeFile(join(root, "third-party/embedded-reviews.json"), JSON.stringify(manifest));
  return { root, components, manifest, save };
}

test("Every QuickJS WASM producer matches its reviewed source", async () => {
  const components = await readJson(join(repository, "third-party/embedded-components.json"));
  const result = await readLicenseEmbeddedReviews(repository, components);
  assert.deepEqual([...result.verified], ["QuickJS-NG"]);
});

test("missing original embedded notices or another SDK revision cannot pass", async (t) => {
  const f = await fixture(t);
  const notices = f.components[0].notices;
  f.components[0].notices = [];
  await assert.rejects(
    readLicenseEmbeddedReviews(f.root, f.components),
    /Missing embedded original notice/,
  );
  f.components[0].notices = notices;
  f.manifest.quickjs.llvmRevision = "0".repeat(40);
  await f.save();
  await assert.rejects(
    readLicenseEmbeddedReviews(f.root, f.components),
    /WASI SDK linked-source mismatch/,
  );
});

test("tampered original Git source and truncated WASM sections are rejected", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, f.manifest.quickjs.sourceTree.file), "edited");
  await assert.rejects(
    readLicenseEmbeddedReviews(f.root, f.components),
    /Changed embedded evidence/,
  );
  assert.throws(
    () => wasmProducerSection(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 127])),
    /Truncated WASM section content/,
  );
});
