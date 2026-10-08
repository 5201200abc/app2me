import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addMarketplace,
  describeMarketplacePlugin,
  ensureDefaultPluginMarketplaces,
  installMarketplacePlugin,
  uninstallMarketplacePlugin,
  updateMarketplace,
} from "../src/plugins/marketplace.js";
import { writeBundledOfficialMarketplacePartitionSync } from "../src/plugins/official-marketplace.js";

const MARKETPLACE_ID = "mycode-plugins-official";

test("bundled plugin components, repeated installation and uninstall work without a remote source", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "mycode-bundled-install-"));
  try {
    const name = "verification";
    const pluginRoot = join(storageRoot, "cache", MARKETPLACE_ID, name, "1.0.0");
    await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "skills", "hello"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version: "1.0.0", description: "Verification fixture" }),
    );
    const skill = "---\nname: hello\ndescription: Verification skill\n---\nSay hello.\n";
    await writeFile(join(pluginRoot, "skills", "hello", "SKILL.md"), skill);
    writeBundledOfficialMarketplacePartitionSync({
      manifest: {
        name: MARKETPLACE_ID,
        plugins: [{ name, version: "1.0.0", source: "filesystem", cachePath: pluginRoot }],
      },
      storageRoot,
    });
    const input = { marketplace: MARKETPLACE_ID, name, storageRoot };
    const details = await describeMarketplacePlugin(input);
    assert.deepEqual(details.diagnostics, []);
    assert.ok(details.components.some((group) => group.kind === "skill" && group.items.length === 1));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await installMarketplacePlugin(input);
      assert.equal(result.installed[0]?.installPath, pluginRoot);
      assert.equal(await readFile(join(pluginRoot, "skills", "hello", "SKILL.md"), "utf8"), skill);
    }
    assert.equal(
      (await uninstallMarketplacePlugin({ pluginId: `${name}@${MARKETPLACE_ID}`, storageRoot }))?.name,
      name,
    );
    assert.equal(
      await uninstallMarketplacePlugin({ pluginId: `${name}@${MARKETPLACE_ID}`, storageRoot }),
      null,
    );
  } finally {
    await rm(storageRoot, { force: true, recursive: true });
  }
});

test("retired remote official catalog migrates to bundled plugins without a network refresh", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "mycode-bundled-marketplace-"));
  try {
    const marketplaceRoot = join(storageRoot, "marketplaces", MARKETPLACE_ID);
    await mkdir(marketplaceRoot, { recursive: true });
    await writeFile(
      join(storageRoot, "known_marketplaces.json"),
      JSON.stringify({
        version: 1,
        marketplaces: [
          {
            id: MARKETPLACE_ID,
            name: MARKETPLACE_ID,
            source: {
              source: "url",
              url: "https://retired.example/official-plugin/marketplace.json",
            },
            addedAt: "2026-01-01T00:00:00.000Z",
            pluginCount: 1,
            lastRefreshFailure: {
              code: "network-error",
              failedAt: "2026-01-02T00:00:00.000Z",
              message: "fetch failed",
            },
          },
        ],
      }),
    );
    await writeFile(
      join(marketplaceRoot, "cdn-marketplace.json"),
      JSON.stringify({ name: MARKETPLACE_ID, plugins: [{ name: "old-remote" }] }),
    );

    writeBundledOfficialMarketplacePartitionSync({
      manifest: { name: MARKETPLACE_ID, plugins: [{ name: "browser-use" }] },
      storageRoot,
    });
    const known = ensureDefaultPluginMarketplaces(storageRoot);
    assert.deepEqual(known[0]?.source, { source: "bundled" });
    assert.equal(known[0]?.lastRefreshFailure, undefined);

    const refreshed = await updateMarketplace({ storageRoot });
    assert.deepEqual(refreshed.map((record) => record.pluginCount), [1]);
    const merged = JSON.parse(await readFile(join(marketplaceRoot, "marketplace.json"), "utf8")) as {
      plugins: { name: string }[];
    };
    assert.deepEqual(merged.plugins.map((plugin) => plugin.name), ["browser-use"]);
    await assert.rejects(readFile(join(marketplaceRoot, "cdn-marketplace.json")));
  } finally {
    await rm(storageRoot, { force: true, recursive: true });
  }
});

test("personal file marketplace still refreshes alongside the bundled catalog", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "mycode-personal-marketplace-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "mycode-personal-marketplace-source-"));
  try {
    writeBundledOfficialMarketplacePartitionSync({
      manifest: { name: MARKETPLACE_ID, plugins: [{ name: "browser-use" }] },
      storageRoot,
    });
    const personalManifestPath = join(sourceRoot, "personal-marketplace.json");
    await writeFile(
      personalManifestPath,
      JSON.stringify({ name: "personal-test", plugins: [] }),
    );
    await addMarketplace({
      source: { source: "file", path: personalManifestPath },
      storageRoot,
    });

    const refreshed = await updateMarketplace({ storageRoot });
    assert.deepEqual(
      refreshed.map((record) => record.id).sort(),
      [MARKETPLACE_ID, "personal-test"].sort(),
    );
  } finally {
    await rm(storageRoot, { force: true, recursive: true });
    await rm(sourceRoot, { force: true, recursive: true });
  }
});
