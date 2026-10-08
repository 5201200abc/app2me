import {
  PROTOCOL_VERSION_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
} from "@modelcontextprotocol/core/internal";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { resolveBuiltInNodeReplMcpServers } from "../apps/mycode-cli/packages/bootstrap/src/app/built-in-node-repl.ts";
import { resolvePluginRuntimeFeatures } from "../apps/mycode-cli/packages/bootstrap/src/app/plugin-runtime-features.ts";
import {
  OFFICIAL_BROWSER_USE_PLUGIN_ID,
  OFFICIAL_CUA_PLUGIN_ID,
  OFFICIAL_NODE_REPL_HOST_PLUGIN_ID,
} from "../apps/mycode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts";

const hostRoot = resolve("apps/mycode-cli/packages/node-repl-host");
let cases = 0;
for (const browser of [false, true]) {
  for (const computer of [false, true]) {
    for (const host of [false, true]) {
      const pluginOutcome = {
        plugins: [
          {
            id: OFFICIAL_BROWSER_USE_PLUGIN_ID,
            enabled: browser,
            rootPath: resolve("apps/mycode-cli/packages/browser-use-plugin"),
          },
          {
            id: OFFICIAL_CUA_PLUGIN_ID,
            enabled: computer,
            rootPath: resolve("apps/mycode-cli/packages/computer-use-plugin"),
          },
          { id: OFFICIAL_NODE_REPL_HOST_PLUGIN_ID, enabled: host, rootPath: hostRoot },
        ],
      };
      const servers = resolveBuiltInNodeReplMcpServers({
        pluginOutcome,
        workingDirectory: process.cwd(),
      });
      const features = resolvePluginRuntimeFeatures(pluginOutcome);
      assert.deepEqual(Object.keys(servers), browser || computer ? ["node_repl"] : []);
      assert.notEqual(features.nodeRepl, true);
      if (servers.node_repl)
        assert.equal(servers.node_repl.args.at(-1), resolve(hostRoot, "dist/mcp/server.js"));
      cases++;
    }
  }
}
assert.deepEqual(
  resolveBuiltInNodeReplMcpServers({
    pluginOutcome: {
      plugins: [
        { id: OFFICIAL_BROWSER_USE_PLUGIN_ID, enabled: true, rootPath: "/fixture/browser" },
      ],
    },
    workingDirectory: process.cwd(),
  }),
  {},
);

const child = spawn(process.execPath, [resolve(hostRoot, "dist/mcp/server.js")], {
  stdio: ["pipe", "pipe", "pipe"],
});
let sequence = 0,
  diagnostics = "";
const pending = new Map();
child.stderr.on("data", (data) => {
  diagnostics += data.toString();
});
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined) pending.get(message.id)?.(message);
});
const call = async (method, params) => {
  const id = ++sequence;
  let timer;
  try {
    const result = await Promise.race([
      new Promise((done) => {
        pending.set(id, done);
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_META_KEY]: {}, [CLIENT_INFO_META_KEY]: { name: "host-health-check", version: "1" } } } })}\n`,
        );
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`${method} timed out: ${diagnostics}`)), 15000);
      }),
    ]);
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result.result;
  } finally {
    clearTimeout(timer);
    pending.delete(id);
  }
};
try {
  const listed = await call("tools/list", {});
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["js"],
  );
  const result = await call("tools/call", {
    name: "js",
    arguments: {
      code: 'nodeRepl.write("node-repl-smoke-ok")',
      title: "检查内部宿主",
      timeout_ms: 10000,
    },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(
    result.content.some(
      (block) => block.type === "text" && block.text.includes("node-repl-smoke-ok"),
    ),
    JSON.stringify(result),
  );
  process.stdout.write(
    `PASS: ${cases} registration combinations; one node_repl server and one js tool; actual MCP JS execution succeeded. Host toggle is not an activation owner.\n`,
  );
} finally {
  lines.close();
  child.kill("SIGTERM");
}
