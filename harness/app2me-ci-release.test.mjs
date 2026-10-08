import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
import {
  nextReleaseVersion,
  prepareVersion,
  preparePushVersions,
} from "../scripts/app2me-ci-version.mjs";
import { assembleRelease, releaseTargets } from "../scripts/app2me-ci-artifacts.mjs";
import { createReleaseManifest, verifyRelease } from "../scripts/app2me-release.mjs";
import { resolveApp2meReleaseIdentity } from "../scripts/app2me-release-identity.mjs";
import { resolveApp2meUpdateChannel } from "../packages/desktop/src/main/app2meUpdateFeed.ts";
import { classifyLicense } from "../scripts/license-policy.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "app2me-ci-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("UTC release identity increases within a second and across days", () => {
  const now = new Date("2026-10-08T01:00:00Z");
  assert.equal(nextReleaseVersion("3.14.3", now).appVersion, "2026.1008.3600");
  assert.equal(nextReleaseVersion("2026.1008.3600", now).appVersion, "2026.1008.3601");
  assert.equal(
    nextReleaseVersion("2026.1008.3600", now, "2026.10.8.60").windowsBuildVersion,
    "2026.10.8.61",
  );
  assert.equal(nextReleaseVersion("2026.1007.90000", now).appVersion, "2026.1008.3600");
  assert.throws(() => nextReleaseVersion("2027.101.0", now), /clock/);
  assert.throws(() => nextReleaseVersion("invalid", now), /Invalid/);
});

test("version preparation retries a rejected push and never increments an already recorded PR", async (t) => {
  const directory = await fixture(t);
  const remote = join(directory, "remote.git");
  const checkout = join(directory, "checkout");
  const exec = promisify(execFile);
  await exec("git", ["init", "--bare", remote]);
  await exec("git", ["init", "-b", "main", checkout]);
  const git = async (args) => (await exec("git", args, { cwd: checkout })).stdout;
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "user.email", "fixture@example.invalid"]);
  await mkdir(join(checkout, "packages/desktop"), { recursive: true });
  await mkdir(join(checkout, ".github/workflows"), { recursive: true });
  await writeFile(join(checkout, ".github/workflows/release.yml"), "name: Fixture\n");
  for (const file of ["package.json", "packages/desktop/package.json"])
    await writeFile(join(checkout, file), JSON.stringify({ name: "fixture", version: "3.14.3" }));
  await git(["add", "."]);
  await git(["commit", "-m", "fixture"]);
  await git(["remote", "add", "origin", remote]);
  await git(["push", "origin", "HEAD:refs/heads/main"]);
  const cwd = process.cwd();
  process.chdir(checkout);
  let failed = false;
  try {
    const first = await prepareVersion(42, "main", async (args) => {
      if (args[0] === "push" && !failed) {
        failed = true;
        throw new Error("rejected push");
      }
      return git(args);
    });
    const second = await prepareVersion(42, "main", git);
    assert.equal(second.sha, first.sha);
    assert.equal(second.version, first.version);
    const desktop = JSON.parse(await readFile("packages/desktop/package.json", "utf8"));
    assert.equal(desktop.version, first.version);
    assert.equal((await git(["log", "origin/main", "--format=%s"])).trim().split("\n").length, 2);
    const before = first.sha;
    for (const name of ["first", "second"]) {
      await writeFile(join(checkout, "source.txt"), name);
      await git(["add", "source.txt"]);
      await git(["commit", "-m", name]);
    }
    const after = (await git(["rev-parse", "HEAD"])).trim();
    await git(["push", "origin", "HEAD:refs/heads/main"]);
    const batch = await preparePushVersions(after, before, "main", git);
    const retry = await preparePushVersions(after, before, "main", git);
    assert.equal(batch.sha, retry.sha);
    assert.notEqual(batch.version, first.version);
    assert.equal((await git(["log", "origin/main", "--format=%s"])).trim().split("\n").length, 6);
    assert.equal(
      (await git(["show", "-s", "--format=%an <%ae>", batch.sha])).trim(),
      "5201200abc <5201200abc@gmail.com>",
    );

    const batchManifest = JSON.parse(await readFile("package.json", "utf8"));
    const identity = nextReleaseVersion(
      batch.version,
      new Date(),
      batchManifest.app2meRelease.windowsBuildVersion,
    );
    for (const file of ["package.json", "packages/desktop/package.json"]) {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.version = identity.appVersion;
      if (file === "package.json")
        manifest.app2meRelease = {
          prepared: true,
          date: identity.date,
          windowsBuildVersion: identity.windowsBuildVersion,
        };
      await writeFile(file, JSON.stringify(manifest));
    }
    await git(["add", "package.json", "packages/desktop/package.json"]);
    await git(["commit", "-m", "prepared source"]);
    const prepared = (await git(["rev-parse", "HEAD"])).trim();
    await git(["push", "origin", "HEAD:refs/heads/main"]);
    const reused = await preparePushVersions(prepared, batch.sha, "main", git);
    assert.equal(reused.sha, prepared);
    assert.equal(reused.version, identity.appVersion);
    assert.equal((await git(["log", "origin/main", "--format=%s"])).trim().split("\n").length, 7);
    await writeFile(join(checkout, "source.txt"), "after prepared release");
    await git(["add", "source.txt"]);
    await git(["commit", "-m", "new source without manual version"]);
    const unprepared = (await git(["rev-parse", "HEAD"])).trim();
    await git(["push", "origin", "HEAD:refs/heads/main"]);
    const incremented = await preparePushVersions(unprepared, prepared, "main", git);
    assert.notEqual(incremented.version, reused.version);
    assert.equal((await git(["log", "origin/main", "--format=%s"])).trim().split("\n").length, 9);
  } finally {
    process.chdir(cwd);
  }
});

async function artifacts(t) {
  const root = await fixture(t);
  const input = join(root, "input");
  await mkdir(input);
  const identity = resolveApp2meReleaseIdentity("2026-10-08", new Date("2026-10-08T01:00:00Z"));
  for (const target of releaseTargets) {
    const directory = join(input, target);
    await mkdir(directory);
    await writeFile(join(directory, `${identity.releaseName}-${target}.zip`), target);
    await createReleaseManifest(directory, identity);
  }
  return { root, input, identity };
}

test("all six matching architectures assemble into one verified release", async (t) => {
  const { root, input, identity } = await artifacts(t);
  const output = join(root, "output");
  await assembleRelease(input, output);
  const manifest = await verifyRelease(output);
  assert.equal(manifest.assets.length, 6);
  assert.equal(manifest.appVersion, identity.appVersion);
});

test("missing architectures cannot be published", async (t) => {
  const { root, input } = await artifacts(t);
  await rm(join(input, "win-arm64"), { recursive: true });
  await assert.rejects(assembleRelease(input, join(root, "output")), /exactly/);
});

test("matching artifacts must also match the prepared CI version", async (t) => {
  const { root, input, identity } = await artifacts(t);
  await assert.rejects(
    assembleRelease(input, join(root, "output"), releaseTargets, {
      ...identity,
      appVersion: "2026.1008.9999",
    }),
    /prepared version/,
  );
});

test("tampered artifacts cannot be published", async (t) => {
  const { root, input, identity } = await artifacts(t);
  await writeFile(join(input, "mac-arm64", `${identity.releaseName}-mac-arm64.zip`), "tampered");
  await assert.rejects(assembleRelease(input, join(root, "output")), /checksum/);
});

test("mixed release identities cannot be published", async (t) => {
  const { root, input, identity } = await artifacts(t);
  await createReleaseManifest(join(input, "win-arm64"), {
    ...identity,
    appVersion: "2026.1008.3601",
  });
  await assert.rejects(assembleRelease(input, join(root, "output")), /identity differs/);
});

test("asset collisions fail instead of silently replacing another architecture", async (t) => {
  const { root, input, identity } = await artifacts(t);
  for (const target of ["mac-x64", "mac-arm64"]) {
    await writeFile(join(input, target, `${identity.releaseName}-extra.zip`), "same");
    await createReleaseManifest(join(input, target), identity);
  }
  await assert.rejects(assembleRelease(input, join(root, "output")), /collision/);
});

test("workflow releases main pushes with six native targets and no write token in builds", async () => {
  const workflow = parse(
    await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  );
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.commit.type, "string");
  assert.deepEqual(
    workflow.jobs.build.strategy.matrix.include.map(({ os, arch }) => `${os}-${arch}`).sort(),
    [...releaseTargets].sort(),
  );
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.build.permissions, undefined);
  const steps = workflow.jobs.build.steps;
  const initialization = steps.findIndex((step) => step.name === "Initialize Windows C++ tools");
  const installation = steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  assert.ok(initialization >= 0 && initialization < installation);
  assert.equal(
    steps.find((step) => step.name === "Verify Windows search source build").shell,
    "pwsh",
  );
  assert.deepEqual(workflow.jobs.publish.needs, ["version", "build"]);
  assert.equal(workflow.jobs.publish.concurrency["cancel-in-progress"], false);
  assert.ok(
    workflow.jobs.build.steps.some(
      (step) => step.run === "node scripts/licenses.mjs check --strict",
    ),
  );
  assert.ok(workflow.jobs.publish.steps.some((step) => step.name === "Reject superseded release"));
});

test("updater channels distinguish architectures", () => {
  assert.equal(resolveApp2meUpdateChannel("x64"), "latest-x64");
  assert.equal(resolveApp2meUpdateChannel("arm64"), "latest-arm64");
  assert.throws(() => resolveApp2meUpdateChannel("ia32"), /Unsupported/);
});

test("license expression precedence cannot hide restrictive AND obligations", () => {
  assert.equal(classifyLicense("MIT AND MPL-2.0"), "yellow-weak");
  assert.equal(classifyLicense("(MIT OR GPL-3.0) AND MPL-2.0"), "yellow-weak");
  assert.equal(classifyLicense("MIT AND GPL-3.0"), "red-gpl");
  assert.equal(classifyLicense("MIT OR (GPL-3.0 AND MPL-2.0)"), "green");
  assert.equal(classifyLicense("MIT AND"), "review");
  assert.equal(classifyLicense("MIT WITH unknown-exception"), "review");
  assert.equal(classifyLicense("UNKNOWN"), "unresolved");
});
