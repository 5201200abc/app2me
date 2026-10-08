import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { stageAgentBundle } from "./stage-agent-bundle.mjs";

const requiredAssets = [
  "packages/cua-driver-plugin/.mycode-plugin/plugin.json",
  "packages/cua-driver-plugin/docs/computer-use.md",
  "packages/cua-driver-plugin/skills/computer-use/SKILL.md",
  "apps/mycode-cli/packages/browser-use-plugin/.mycode-plugin/plugin.json",
  "apps/mycode-cli/packages/browser-use-plugin/scripts/browser-client.mjs",
  ...["api.json", "documents.json", "overview.md", "recording.md", "workflow.md"].map(
    (name) => `apps/mycode-cli/packages/browser-use-plugin/docs/${name}`,
  ),
  "apps/mycode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md",
  "apps/mycode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md",
  "apps/mycode-cli/packages/node-repl-host/.mycode-plugin/plugin.json",
  "apps/mycode-cli/packages/node-repl-host/dist/mcp/server.js",
  ...["SKILL.md", "patterns.md", "examples.md"].map(
    (name) => `apps/mycode-cli/packages/bundled-skills/skills/dynamic-workflows/${name}`,
  ),
];

async function fixture(t) {
  const repoRoot = await mkdtemp(resolve(tmpdir(), "mycode-agent-assets-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  for (const path of ["apps/mycode-cli/packages/cli/dist/mycode.cjs", ...requiredAssets]) {
    const target = resolve(repoRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, path);
  }
  return repoRoot;
}

test("shared desktop staging includes CUA content and preserves browser/runtime assets", async (t) => {
  const repoRoot = await fixture(t);
  const glm = resolve(repoRoot, "packages/desktop/bundled-agents/darwin-arm64/glm");
  await mkdir(glm, { recursive: true });
  await writeFile(resolve(glm, "obsolete-agent"), "old");
  const excluded = resolve(repoRoot, "packages/cua-driver-plugin/docs/__pycache__/cached.pyc");
  await mkdir(dirname(excluded), { recursive: true });
  await writeFile(excluded, "excluded");
  await stageAgentBundle({ repoRoot, platformKey: "darwin-arm64", log() {} });
  for (const source of requiredAssets) {
    const staged = source.replace(/^apps\/mycode-cli\//, "");
    assert.equal(await readFile(resolve(glm, staged), "utf8"), source);
  }
  await assert.rejects(readFile(resolve(glm, "obsolete-agent")), { code: "ENOENT" });
  await assert.rejects(
    readFile(resolve(glm, "packages/cua-driver-plugin/docs/__pycache__/cached.pyc")),
    {
      code: "ENOENT",
    },
  );
});

test("missing CUA skill fails before erasing the existing Agent bundle", async (t) => {
  const repoRoot = await fixture(t);
  await rm(resolve(repoRoot, "packages/cua-driver-plugin/skills/computer-use/SKILL.md"));
  const glm = resolve(repoRoot, "packages/desktop/bundled-agents/darwin-arm64/glm");
  await mkdir(glm, { recursive: true });
  await writeFile(resolve(glm, "mycode.cjs"), "previous-good-bundle");
  await assert.rejects(
    async () => await stageAgentBundle({ repoRoot, platformKey: "darwin-arm64", log() {} }),
    /computer-use\/SKILL\.md/,
  );
  assert.equal(await readFile(resolve(glm, "mycode.cjs"), "utf8"), "previous-good-bundle");
});
