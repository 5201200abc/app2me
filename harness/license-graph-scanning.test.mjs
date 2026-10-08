import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readWorkspaceProductionGraph,
  assertProductionGraphs,
  missingProductionPackages,
} from "../scripts/third-party-npm.mjs";

const graph = [{ name: "fixture", dependencies: { dependency: { version: "1.0.0" } } }];

test("license scans compare installed snapshots without traversing the installed tree", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "app2me-license-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules/.pnpm"), { recursive: true });
  const lock = JSON.stringify({ lockfileVersion: 9, importers: {}, packages: {} });
  await writeFile(join(root, "pnpm-lock.yaml"), lock);
  await writeFile(join(root, "node_modules/.pnpm/lock.yaml"), lock);
  let active = 0;
  const calls = [];
  const result = await readWorkspaceProductionGraph(root, async (command, args) => {
    assert.equal(command, "pnpm");
    assert.equal(++active, 1);
    calls.push(args.includes("--lockfile-only"));
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return { stdout: JSON.stringify(graph) };
  });
  assert.deepEqual(calls, [true]);
  await writeFile(
    join(root, "node_modules/.pnpm/lock.yaml"),
    JSON.stringify({ lockfileVersion: 9, importers: {}, packages: { stale: {} } }),
  );
  await assert.rejects(
    () =>
      readWorkspaceProductionGraph(root, async () => {
        throw new Error("Must not execute on a stale installation");
      }),
    /Installed lock snapshot differs/,
  );
  assert.equal(result.required.get("dependency@1.0.0").version, "1.0.0");
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
