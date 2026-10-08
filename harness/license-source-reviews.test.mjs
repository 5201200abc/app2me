import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { readLicenseSourceReviews } from "../scripts/license-source-reviews.mjs";

const repository = resolve(import.meta.dirname, "..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "app2me-source-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = await readLicenseSourceReviews(repository);
  for (const file of ["third-party/source-reviews.json", ...Object.keys(original.rawInputs)]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(repository, file), join(root, file));
  }
  const manifestPath = join(root, "third-party/source-reviews.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { root, manifest, save: () => writeFile(manifestPath, JSON.stringify(manifest)) };
}

test("published metadata and corresponding MPL sources cover the 16 exact package versions", async () => {
  const { verified } = await readLicenseSourceReviews(repository);
  assert.equal(verified.size, 16);
  assert.equal(
    verified.get("@trycua/cua-driver-win32-arm64-msvc@0.30.4").sourceRevision,
    "bf6c76786d938070f4ecf1e44004752f69f518b8",
  );
  assert.ok(
    verified
      .get("@ubjs/core@0.31.0-3")
      .sources.some((source) => source.revision === "49bc59194d183a05855ed4104c18eb92fb465e02"),
  );
});

test("modified source archives or publisher metadata cannot pass the gate", async (t) => {
  const f = await fixture(t);
  const source = f.manifest.archives[0];
  const original = await readFile(join(f.root, source.file));
  await writeFile(join(f.root, source.file), Buffer.concat([original, Buffer.from("tampered")]));
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Changed source evidence/);
  await writeFile(join(f.root, source.file), original);
  await writeFile(join(f.root, f.manifest.packages[0].metadataFile), "{}");
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Changed source evidence/);
});

test("a source review cannot admit a GPL replacement or another Git revision", async (t) => {
  const f = await fixture(t);
  f.manifest.packages[0].license = "GPL-3.0-only";
  await f.save();
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Unsupported source review license/);
  f.manifest.packages[0].license = "MIT AND MPL-2.0";
  f.manifest.packages[0].sourceRevision = "0".repeat(40);
  await f.save();
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Publisher release tag mismatch/);
});

test("a missing MPL crate and a fabricated Cargo checksum both fail", async (t) => {
  const f = await fixture(t);
  const crate = f.manifest.archives.find((source) => source.cargoChecksum);
  crate.cargoChecksum = "0".repeat(64);
  await f.save();
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Invalid immutable source URL/);
  crate.cargoChecksum = crate.sha256;
  f.manifest.archives = f.manifest.archives.filter((source) => source !== crate);
  await f.save();
  await assert.rejects(() => readLicenseSourceReviews(f.root), /Missing MPL crate source/);
});

test("missing audit or package source coverage cannot bypass the gate", async (t) => {
  const f = await fixture(t);
  const audit = f.manifest.rustAudit;
  delete f.manifest.rustAudit;
  await f.save();
  await assert.rejects(readLicenseSourceReviews(f.root), /Missing Rust audit/);
  f.manifest.rustAudit = audit;
  f.manifest.packages[0].sources.pop();
  await f.save();
  await assert.rejects(readLicenseSourceReviews(f.root), /Missing package MPL source/);
});
