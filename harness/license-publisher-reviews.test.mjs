import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readLicensePublisherReviews } from "../scripts/license-publisher-reviews.mjs";

const repository = resolve(import.meta.dirname, "..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "app2me-publisher-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(
    await readFile(join(repository, "third-party/publisher-reviews.json"), "utf8"),
  );
  for (const record of manifest.packages) {
    for (const path of [record.metadataFile, record.archiveFile]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(join(repository, path), join(root, path));
    }
  }
  const save = () =>
    writeFile(join(root, "third-party/publisher-reviews.json"), JSON.stringify(manifest));
  await save();
  return { root, manifest, save };
}

test("eleven exact publisher archives preserve their original grants and all notices", async () => {
  const result = await readLicensePublisherReviews(repository);
  assert.equal(result.verified.size, 11);
  assert.equal(result.verified.get("semaphore@1.1.0").declarationMember, "package/bower.json");
});

test("edited publisher bytes and registry integrity cannot pass", async (t) => {
  const f = await fixture(t);
  const record = f.manifest.packages[0];
  await writeFile(join(f.root, record.archiveFile), "edited");
  await assert.rejects(readLicensePublisherReviews(f.root), /Changed publisher evidence/);
  record.archiveSha256 = createHash("sha256").update("edited").digest("hex");
  await f.save();
  await assert.rejects(readLicensePublisherReviews(f.root), /Publisher archive integrity mismatch/);
});

test("missing member or notice coverage is rejected", async (t) => {
  const f = await fixture(t);
  const record = f.manifest.packages[0];
  const member = record.members.pop();
  await f.save();
  await assert.rejects(readLicensePublisherReviews(f.root), /Incomplete publisher member audit/);
  record.members.push(member);
  record.noticeMembers.pop();
  await f.save();
  await assert.rejects(readLicensePublisherReviews(f.root), /Incomplete original notice coverage/);
});

test("changed license declarations or unreviewed versions cannot inherit admission", async (t) => {
  const f = await fixture(t);
  const record = f.manifest.packages[0];
  record.license = "GPL-3.0-only";
  await f.save();
  await assert.rejects(readLicensePublisherReviews(f.root), /Unsupported publisher grant/);
  record.license = "MIT";
  record.package = "unsafe-pointer@99.0.0";
  await f.save();
  await assert.rejects(readLicensePublisherReviews(f.root), /Original publisher grant mismatch/);
});
