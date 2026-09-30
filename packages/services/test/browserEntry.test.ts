import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("services public entry loads in browsers without Node builtins or globals", async () => {
  // 根入口曾转导出本地模型扫描器，Vite dev 在 React 挂载前访问 node:fs 并卡在 Logo。
  // 禁用摇树并实际求值整个入口，避免生产构建恰好删掉未使用导出而漏掉开发期故障。
  const result = await build({
    stdin: {
      contents: 'export * from "@mycode/services";',
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "browserServices",
    treeShaking: false,
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source, "browser bundle must be produced");
  const exports = runInNewContext(
    `${source}\nbrowserServices;`,
    { URL, URLSearchParams },
    { timeout: 5_000 },
  );
  assert.ok(exports.IFileService, "browser service descriptors remain available");
  assert.equal(typeof exports.ServiceCollection, "function");
  for (const name of ["discoverLocalModels", "getDefaultLocalModelsDirectory", "isQwen38Model"]) {
    assert.equal(name in exports, false, `${name} belongs to the Node entry`);
  }
});
