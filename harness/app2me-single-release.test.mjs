import { createRequire } from "node:module";
import { dirname } from "node:path";
import { access } from "node:fs/promises";
import {
  createAppAsarPackArgs,
  verifyUnpackedDesktopSdkEntries,
} from "../packages/desktop/scripts/app-asar-repack.mjs";
import { collectRuntimeModuleClosureEntries } from "../packages/desktop/scripts/runtime-dependency-closure.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createReleaseManifest,
  run,
  digestFile,
  promoteRelease,
  publishRelease,
  verifyRelease,
  withReleaseLock,
} from "../scripts/app2me-release.mjs";
import { resolveApp2meReleaseIdentity } from "../scripts/app2me-release-identity.mjs";
import { resolveDesktopProductIdentity } from "../packages/desktop/scripts/desktop-product-identity.mjs";
import {
  APP2ME_RELEASE_FEED_URL,
  usesApp2meReleaseFeed,
  shouldEnableDesktopUpdates,
} from "../packages/desktop/src/main/app2meUpdateFeed.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "app2me-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function build(root, date, contents) {
  const directory = await mkdtemp(join(root, ".build-"));
  const identity = resolveApp2meReleaseIdentity(date, new Date("2026-10-07T19:30:00Z"));
  await writeFile(join(directory, `${identity.releaseName}-mac-arm64.zip`), contents);
  await createReleaseManifest(directory, identity);
  return directory;
}

test("app2me owns the outer product, while stable IDs and MyCode/MyChat implementation remain compatible", async () => {
  const identity = resolveDesktopProductIdentity({ MYCODE_ENV: "production" });
  assert.equal(identity.productName, "app2me");
  assert.equal(identity.appId, "dev.mycode.app");
  assert.equal(identity.linuxPackageName, "app2me");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.name, "app2me");
  assert.equal(
    JSON.parse(await readFile(new URL("../packages/desktop/package.json", import.meta.url)))
      .productName,
    "app2me",
  );
  assert.equal(pkg.scripts.release, "node scripts/app2me-release.mjs");
  assert.equal(
    JSON.parse(await readFile(new URL("../packages/desktop/package.json", import.meta.url))).name,
    "@app2me/desktop",
  );
  assert.match(
    await readFile(
      new URL("../packages/ui/src/mychat/MyChatWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    /MyChat/,
  );
});

test("public date name is independent of monotonically increasing internal updater version", () => {
  const one = resolveApp2meReleaseIdentity("2026-09-28", new Date("2026-09-28T00:00:01Z"));
  const two = resolveApp2meReleaseIdentity("2026-09-28", new Date("2026-09-28T23:59:59Z"));
  assert.equal(one.releaseName, "app2me-2026-09-28");
  assert.equal(two.releaseName, one.releaseName);
  assert.ok(Number(two.appVersion.split(".")[2]) > Number(one.appVersion.split(".")[2]));
  assert.ok(two.windowsBuildVersion.split(".").every((part) => Number(part) <= 65535));
  assert.throws(() => resolveApp2meReleaseIdentity("2026-02-30"));
  assert.throws(() => resolveApp2meReleaseIdentity("../escape"));
});

test("only packaged production reads the fixed app2me latest feed; Dev/Preview keep their existing boundary", () => {
  assert.equal(
    APP2ME_RELEASE_FEED_URL,
    "https://github.com/5201200abc/app2me/releases/download/latest",
  );
  assert.equal(usesApp2meReleaseFeed(true, "production"), true);
  assert.equal(usesApp2meReleaseFeed(false, "production"), false);
  assert.equal(usesApp2meReleaseFeed(true, "preview"), false);
  assert.equal(shouldEnableDesktopUpdates(true, "production", false), true);
  assert.equal(shouldEnableDesktopUpdates(false, "production", false), false);
  assert.equal(shouldEnableDesktopUpdates(false, "production", true), true);
  assert.equal(shouldEnableDesktopUpdates(true, "preview", true), false);
});

test("later date and repeated same date replace the only local distribution", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "app2me-2026-09-16"));
  await promoteRelease(await build(root, "2026-09-16", "old"), root);
  await promoteRelease(await build(root, "2026-09-28", "new"), root);
  assert.deepEqual(await readdir(root), ["current"]);
  let manifest = await verifyRelease(join(root, "current"));
  assert.equal(manifest.releaseName, "app2me-2026-09-28");
  await promoteRelease(await build(root, "2026-09-28", "replacement"), root);
  manifest = await verifyRelease(join(root, "current"));
  assert.equal(
    await readFile(join(root, "current", manifest.assets[0].name), "utf8"),
    "replacement",
  );
  assert.deepEqual(await readdir(root), ["current"]);
});

test("invalid new build never deletes the last valid distribution", async (t) => {
  const root = await fixture(t);
  await promoteRelease(await build(root, "2026-09-16", "old"), root);
  const next = await build(root, "2026-09-28", "new");
  await writeFile(join(next, "app2me-2026-09-28-mac-arm64.zip"), "corrupt");
  await assert.rejects(promoteRelease(next, root), /checksum mismatch/);
  assert.equal((await verifyRelease(join(root, "current"))).releaseName, "app2me-2026-09-16");
});

test("release lock rejects concurrent writes, releases after failure and never races to remove a dead owner lock", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    withReleaseLock(root, async () => {
      await assert.rejects(
        withReleaseLock(root, async () => {}),
        /already running/,
      );
      throw new Error("build failed");
    }),
    /build failed/,
  );
  await withReleaseLock(root, async () => {});
  await writeFile(join(root, ".release.lock"), JSON.stringify({ pid: 2147483647 }));
  await assert.rejects(
    withReleaseLock(root, async () => {}),
    /stale release lock/,
  );
  await rm(join(root, ".release.lock"));
  await withReleaseLock(root, async () => {});
  assert.deepEqual(await readdir(root), []);
});

function githubFixture({ invalidDigest = false, firstRelease = false } = {}) {
  const releases = [
    {
      id: 1,
      tag_name: "latest",
      name: "app2me-2026-09-16",
      draft: false,
      html_url: "https://github.com/5201200abc/app2me/releases/tag/latest",
    },
    { id: 2, tag_name: "app2me-2026-09-16", name: "Historical build with a custom title" },
  ];
  const assets = [
    { id: 1, name: "app2me-2026-09-16-mac-arm64.zip", size: 3, digest: "sha256:old" },
  ];
  if (firstRelease) {
    releases.length = 0;
    assets.length = 0;
  }
  let validatedUpload = false;
  let nextAssetId = 10;
  const gh = async (args) => {
    if (args[0] === "release" && args[1] === "create") {
      releases.push({
        id: 1,
        tag_name: "latest",
        name: args[args.indexOf("--title") + 1],
        draft: true,
        html_url: "https://github.com/5201200abc/app2me/releases/tag/latest",
      });
      return "";
    }
    if (args[0] === "release" && args[1] === "upload") {
      const path = args[3];
      const contents = await readFile(path);
      const digest = invalidDigest ? "sha256:invalid" : `sha256:${await digestFile(path)}`;
      assets.push({
        id: nextAssetId++,
        name: path.split("/").at(-1),
        size: contents.length,
        digest,
      });
      return "";
    }
    if (args[0] === "release" && args[1] === "edit") {
      releases[0].name = args[args.indexOf("--title") + 1];
      releases[0].draft = false;
      return "";
    }
    if (args[0] === "release" && args[1] === "delete") {
      releases.splice(1, 1);
      return "";
    }
    const path = args[1].replace("repos/5201200abc/app2me/", "");
    if (path === "releases?per_page=100") return JSON.stringify(releases);
    if (path === "releases/tags/latest") {
      assert.equal(releases[0].draft, false, "draft cannot be looked up by tag");
      return JSON.stringify(releases[0]);
    }
    if (path === "releases/1/assets?per_page=100") {
      validatedUpload = true;
      return JSON.stringify(assets);
    }
    const id = Number(path.split("/").at(-1));
    if (args.includes("DELETE")) {
      assert.equal(validatedUpload, true);
      assets.splice(
        assets.findIndex((asset) => asset.id === id),
        1,
      );
      return "";
    }
    if (args.includes("PATCH")) {
      assets.find((asset) => asset.id === id).name = args.at(-1).slice(5);
      return "";
    }
    throw new Error(`Unhandled GitHub request ${args.join(" ")}`);
  };
  return { gh, releases, assets };
}

test("GitHub latest keeps one dated release and removes old assets only after new digest verification", async (t) => {
  const root = await fixture(t);
  const next = await build(root, "2026-09-28", "new");
  const remote = githubFixture();
  await publishRelease(next, remote);
  assert.equal(remote.releases.length, 1);
  assert.equal(remote.releases[0].tag_name, "latest");
  assert.equal(remote.releases[0].name, "app2me-2026-09-28");
  assert.deepEqual(
    remote.assets.map((asset) => asset.name),
    ["app2me-2026-09-28-mac-arm64.zip"],
  );
});

test("GitHub verification failure preserves the previously published installer", async (t) => {
  const root = await fixture(t);
  const next = await build(root, "2026-09-28", "new");
  const remote = githubFixture({ invalidDigest: true });
  await assert.rejects(publishRelease(next, remote), /verification failed/);
  assert.equal(remote.releases[0].name, "app2me-2026-09-16");
  assert.ok(remote.assets.some((asset) => asset.name === "app2me-2026-09-16-mac-arm64.zip"));
  assert.equal(remote.assets.length, 1);
});

test("first publication resolves the draft ID without querying an unpublished tag", async (t) => {
  const root = await fixture(t);
  const next = await build(root, "2026-10-07", "new");
  const remote = githubFixture({ firstRelease: true });
  await publishRelease(next, remote);
  assert.equal(remote.releases.length, 1);
  assert.equal(remote.releases[0].draft, false);
  assert.equal(remote.assets.length, 1);
});

test("manifest excludes builder diagnostics and validates the actual update feed bytes", async (t) => {
  const root = await fixture(t);
  const next = await build(root, "2026-10-07", "new");
  const identity = resolveApp2meReleaseIdentity("2026-10-07", new Date("2026-10-07T19:30:00Z"));
  const name = `${identity.releaseName}-mac-arm64.zip`;
  const feed = {
    version: identity.appVersion,
    files: [{ url: name, size: 3, sha512: await digestFile(join(next, name), "sha512", "base64") }],
  };
  await writeFile(join(next, "builder-debug.yml"), "debug: private-build-details");
  await writeFile(join(next, "latest-mac.yml"), JSON.stringify(feed));
  const manifest = await createReleaseManifest(next, identity);
  assert.deepEqual(
    manifest.assets.map((asset) => asset.name),
    [name, "latest-mac.yml"],
  );
  feed.files[0].sha512 = "invalid";
  await writeFile(join(next, "latest-mac.yml"), JSON.stringify(feed));
  await assert.rejects(createReleaseManifest(next, identity), /checksum mismatch/);
});

test("runtime closure includes jszip startup dependencies that hoisted packaging omitted", async () => {
  const modules = collectRuntimeModuleClosureEntries(
    ["jszip"],
    [
      new URL("../packages/desktop", import.meta.url).pathname,
      new URL("..", import.meta.url).pathname,
    ],
  );
  for (const item of modules) {
    const pkg = JSON.parse(await readFile(item.packageJsonPath));
    assert.equal(pkg.name, item.moduleName, `Resolved wrong package root for ${item.moduleName}`);
  }
  for (const name of [
    "jszip",
    "setimmediate",
    "lie",
    "pako",
    "readable-stream",
    "string_decoder",
  ]) {
    assert.ok(
      modules.some((item) => item.moduleName === name && item.sourceModulePath),
      `Missing ${name}`,
    );
  }
});

test("asar repacking retains physical Cua and Ubjs SDK paths in hidden staging directories", async (t) => {
  const root = await fixture(t);
  const sourceDir = join(root, ".hidden", "source");
  for (const name of ["@trycua/cua-driver", "@ubjs/core"]) {
    const sdk = join(sourceDir, "node_modules", name, "dist");
    await mkdir(sdk, { recursive: true });
    await writeFile(join(sdk, "electron.js"), "export const loaded = true;");
    await writeFile(join(sdk, "embedded.js"), "export const loaded = true;");
  }
  await writeFile(join(sourceDir, "package.json"), JSON.stringify({ name: "fixture" }));
  const destinationPath = join(root, "app.asar");
  const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
  const cli = join(dirname(require.resolve("@electron/asar/package.json")), "bin", "asar.js");
  await run(process.execPath, [
    cli,
    ...createAppAsarPackArgs({ sourceDir, destinationPath, targetPlatformKey: "darwin-arm64" }),
  ]);
  for (const name of ["@trycua/cua-driver", "@ubjs/core"]) {
    await access(join(`${destinationPath}.unpacked`, "node_modules", name, "dist", "electron.js"));
  }
  await verifyUnpackedDesktopSdkEntries(destinationPath);
  await rm(join(`${destinationPath}.unpacked`, "node_modules/@trycua/cua-driver/dist/embedded.js"));
  await assert.rejects(verifyUnpackedDesktopSdkEntries(destinationPath), /ENOENT/);
});

test("independent uploads overlap, and verification rollback removes every completed new asset", async (t) => {
  const root = await fixture(t);
  const next = await build(root, "2026-10-07", "new");
  const identity = resolveApp2meReleaseIdentity("2026-10-07", new Date("2026-10-07T19:30:00Z"));
  await writeFile(join(next, `${identity.releaseName}-mac-arm64.dmg`), "new-dmg");
  await createReleaseManifest(next, identity);
  const remote = githubFixture({ invalidDigest: true });
  let active = 0;
  let peak = 0;
  const gh = async (args) => {
    if (args[0] !== "release" || args[1] !== "upload") return remote.gh(args);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return await remote.gh(args);
    } finally {
      active--;
    }
  };
  await assert.rejects(publishRelease(next, { gh }), /verification failed/);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(remote.assets.length, 1);
  assert.equal(remote.assets[0].name, "app2me-2026-09-16-mac-arm64.zip");
});
