import assert from "node:assert/strict";
import { test } from "node:test";
import { MYCODE_SESSION_MCP_RESOLUTION_ENV_KEY, mycodeProtocolMethods } from "@mycode/shared";
import { resolveProtocolSessionMcpServers } from "../src/mycode-protocol/session-mcp-resolution.js";
import { protocolMcpServersToRuntimeMcpConfig } from "../src/mycode-protocol/protocol-mcp-config.js";
const hostEnv = { [MYCODE_SESSION_MCP_RESOLUTION_ENV_KEY]: "1" };

test("session startup requests fresh Host MCP and supplies it to the runtime config", async () => {
  let generation = 0;
  const workspace = { workspacePath: "/local", workspaceKey: "/local" };
  const browser = { name: "browser", command: "/browser", args: [], env: [] };
  const context = {
    async requestClient(method, params, schema) {
      assert.equal(method, mycodeProtocolMethods.interactionResolveSessionMcpServers);
      assert.deepEqual(params, { workspace, mcpServers: [browser] });
      generation++;
      return schema.parse({ mcpServers: [browser, {
        name: "cua_driver", command: "/driver", args: ["mcp"],
        env: [{ name: "SOCKET", value: `generation-${generation}` }], isolation: "session",
      }] });
    },
  };
  for (const expected of [1, 2]) {
    const servers = await resolveProtocolSessionMcpServers(context, workspace, [browser], hostEnv);
    const runtime = protocolMcpServersToRuntimeMcpConfig(servers);
    assert.equal(runtime?.servers?.cua_driver?.env?.SOCKET, `generation-${expected}`);
    assert.ok(runtime?.servers?.browser);
  }
});

test("Host resolution errors propagate; stale connections are never reused", async () => {
  await assert.rejects(resolveProtocolSessionMcpServers({
    requestClient: async () => { throw new Error("Main unavailable"); },
  }, { workspacePath: "/local", workspaceKey: "/local" }, undefined, hostEnv), /Main unavailable/);
});

test("standalone and hosts without the capability do not issue a new reverse request", async () => {
  const server = { name: "user", command: "/user", args: [], env: [] };
  for (const env of [undefined, {}, { [MYCODE_SESSION_MCP_RESOLUTION_ENV_KEY]: "0" }]) {
    assert.deepEqual(await resolveProtocolSessionMcpServers({
      requestClient: async () => assert.fail("host capability missing"),
    }, { workspacePath: "/local", workspaceKey: "/local" }, [server], env), [server]);
  }
});
