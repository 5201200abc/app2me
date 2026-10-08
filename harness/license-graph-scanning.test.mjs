import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readWorkspaceProductionGraph,
  assertProductionGraphs,
  missingProductionPackages,
  productionGraphFromLock,
} from "../scripts/third-party-npm.mjs";

const graph = [{ name: "fixture", dependencies: { dependency: { version: "1.0.0" } } }];

test("license scans compare installed snapshots without traversing the installed tree", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "app2me-license-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules/.pnpm"), { recursive: true });
  const lock = JSON.stringify({
    lockfileVersion: 9,
    importers: { ".": { dependencies: { dependency: { version: "1.0.0" } } } },
    packages: { "dependency@1.0.0": {} },
    snapshots: { "dependency@1.0.0": {} },
  });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  await writeFile(join(root, "pnpm-lock.yaml"), lock);
  await writeFile(join(root, "node_modules/.pnpm/lock.yaml"), lock);
  const result = await readWorkspaceProductionGraph(root);
  await writeFile(
    join(root, "node_modules/.pnpm/lock.yaml"),
    JSON.stringify({ lockfileVersion: 9, importers: {}, packages: { stale: {} } }),
  );
  await assert.rejects(() => readWorkspaceProductionGraph(root), /Installed lock snapshot differs/);
  assert.equal(result.required.get("dependency@1.0.0").version, "1.0.0");
  assert.equal(result.projects[0].name, "fixture");
});

test("missing or stale installed versions still fail the release scan", () => {
  assert.throws(() => assertProductionGraphs(graph, []), /Missing: dependency@1.0.0/);
  assert.throws(() => assertProductionGraphs([], graph), /Stale: dependency@1.0.0/);
  assert.throws(
    () =>
      missingProductionPackages(
        new Map([["native@1.0.0", { name: "native", version: "1.0.0" }]]),
        new Map(),
      ),
    /Missing installed dependency: native@1.0.0/,
  );
});

test("production lock traversal preserves optional, peer variants and cyclic edges", () => {
  const lock = {
    lockfileVersion: 9,
    importers: {
      ".": {
        dependencies: {
          a: { version: "1.0.0(peer@1.0.0)" },
          workspace: { version: "link:packages/workspace" },
        },
        optionalDependencies: { a2: { version: "2.0.0" } },
        devDependencies: { development: { version: "1.0.0" } },
      },
      "packages/workspace": { dependencies: { a: { version: "1.0.0(peer@2.0.0)" } } },
    },
    packages: { "a@1.0.0": {}, "a2@2.0.0": {}, "peer@1.0.0": {}, "peer@2.0.0": {} },
    snapshots: {
      "a@1.0.0(peer@1.0.0)": { dependencies: { peer: "1.0.0" } },
      "a@1.0.0(peer@2.0.0)": { dependencies: { peer: "2.0.0" } },
      "a2@2.0.0": { optionalDependencies: { a: "1.0.0(peer@1.0.0)" } },
      "peer@1.0.0": { dependencies: { a: "1.0.0(peer@1.0.0)" } },
      "peer@2.0.0": {},
    },
  };
  const { required, projects } = productionGraphFromLock("/fixture", lock);
  assert.deepEqual([...required.keys()].sort(), [
    "a2@2.0.0",
    "a@1.0.0",
    "peer@1.0.0",
    "peer@2.0.0",
  ]);
  assert.equal(projects.length, 2);
  delete lock.snapshots["peer@2.0.0"];
  assert.throws(
    () => productionGraphFromLock("/fixture", lock),
    /Missing production lock snapshot/,
  );
});
