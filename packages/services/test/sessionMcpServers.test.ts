import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRemoteWorkspaceIdentity } from "@mycode/shared";
import { resolveSessionMcpServers } from "../src/mycode-agent/sessionMcpServers.js";

const workspace = { workspacePath: "/local", workspaceKey: "/local" };
const server = { name: "cua_driver", command: "/driver", args: ["mcp"], env: [] };

test("runtime startup resolves native MCP with the trusted Agent workspace", async () => {
  let calls = 0;
  const result = await resolveSessionMcpServers({
    params: { workspace },
    workspace,
    resolver: {
      async resolveMcpServers(servers, context) {
        calls++;
        assert.equal(servers, undefined);
        assert.equal(context?.workspacePath, "/local");
        return [server];
      },
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { mcpServers: [server] });
});

test("remote scopes preserve existing MCP without resolving the local desktop", async () => {
  const resolver = { resolveMcpServers: async () => assert.fail("remote touched Main") };
  const identity = buildRemoteWorkspaceIdentity("/local", {
    kind: "ssh",
    host: "host",
    username: "user",
  });
  for (const scope of [{ workspaceIdentity: identity }, { remoteSessionId: "remote" }]) {
    const remote = { ...workspace, ...scope, workspaceKey: scope.workspaceIdentity ?? "/local" };
    assert.deepEqual(
      await resolveSessionMcpServers({
        params: { workspace: remote, mcpServers: [server] },
        workspace: remote,
        resolver,
      }),
      { mcpServers: [server] },
    );
  }
});

test("scope mismatch and malformed resolver output reject before runtime initialization", async () => {
  let calls = 0;
  const resolver = {
    resolveMcpServers: async () => {
      calls++;
      return [server];
    },
  };
  for (const forged of [
    { ...workspace, workspacePath: "/other", workspaceKey: "/other" },
    { ...workspace, workspaceIdentity: "other", workspaceKey: "other" },
    { ...workspace, remoteSessionId: "other" },
  ]) {
    await assert.rejects(
      resolveSessionMcpServers({ params: { workspace: forged }, workspace, resolver }),
      /workspace mismatch/,
    );
  }
  assert.equal(calls, 0);
  await assert.rejects(
    resolveSessionMcpServers({
      params: { workspace, extra: true },
      workspace,
      resolver,
    }),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    resolveSessionMcpServers({
      params: { workspace },
      workspace,
      resolver: {
        resolveMcpServers: async () => [{ ...server, env: [{ name: "bad", value: 42 }] }],
      },
    }),
  );
});

test("Host without a native resolver preserves original MCP", async () => {
  assert.deepEqual(await resolveSessionMcpServers({ params: { workspace }, workspace }), {});
  assert.deepEqual(
    await resolveSessionMcpServers({
      params: { workspace, mcpServers: [server] },
      workspace,
    }),
    { mcpServers: [server] },
  );
});
