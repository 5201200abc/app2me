import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolveFilesystemSeedSource } from "../src/app/bundled-plugins-candidate-base-dirs.js";

test("Computer Use seed carries the native skill, docs and matching manifest version without legacy runtime", async () => {
  const source = resolveFilesystemSeedSource();
  const plugin = source?.plugins.find(({ definition }) => definition.name === "computer-use");
  assert.ok(plugin, "Computer Use source was not discoverable");
  assert.equal(plugin.definition.listing?.displayName_i18n?.["zh-CN"], "计算机使用");
  assert.deepEqual(plugin.missingSeedPaths, []);
  assert.deepEqual(plugin.definition.hostMcpServerNames, ["cua_driver"]);
  assert.deepEqual(plugin.definition.runtimeTopLevelPaths, []);
  const manifest = plugin.files.find((file) => file.path === ".mycode-plugin/plugin.json");
  assert.ok(manifest?.sourcePath);
  const data = JSON.parse(await readFile(manifest.sourcePath, "utf8"));
  assert.equal(data.name, "computer-use");
  assert.equal(data.version, plugin.definition.version);
  assert.ok(plugin.files.some((file) => file.path === "skills/computer-use/SKILL.md"));
  assert.ok(plugin.files.some((file) => file.path === "docs/computer-use.md"));
  assert.ok(!plugin.files.some((file) => file.path.startsWith("runtime/") || file.path.startsWith("scripts/")));
});
