import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createMcpAdapter } from "../apps/mycode-cli/packages/adapters/src/mcp/index.ts";
import { NodeMcpAdapter } from "../apps/mycode-cli/packages/adapters/src/mcp/adapter.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycode-mcp-lifecycle-"));
  const script = join(root, "server.mjs");
  await writeFile(
    script,
    String.raw`
import { createInterface } from 'node:readline';
const input = createInterface({input: process.stdin});
const send = (id, result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0', id, result})+'\n');
input.on('line', line => {
 const message = JSON.parse(line);
 if (message.id === undefined) return;
 if (message.method === 'initialize') return send(message.id, {protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'mycode-lifecycle-test',version:'1.0.0'}});
 if (message.method === 'tools/list') return send(message.id, {tools:['echo','wait','crash'].map(name => ({name,description:name,inputSchema:{type:'object',properties:{text:{type:'string'}}}}))});
 if (message.method === 'ping') return send(message.id, {});
 if (message.method === 'tools/call') {
  const respond = () => send(message.id, {content:[{type:'text',text:message.params.arguments.text??message.params.name}]});
  if (message.params.name === 'wait') return void setTimeout(respond, 250);
  respond();
  if (message.params.name === 'crash') setTimeout(() => process.exit(17), 20);
  return;
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\n');
});
`,
  );
  const adapter = createMcpAdapter({ workingDirectory: root });
  t.after(async () => {
    try {
      await adapter.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  const config = {
    type: "stdio",
    command: process.execPath,
    args: [script],
    enabled: true,
    timeoutMs: 5000,
  };
  assert.equal((await adapter.connectServer("fixture", config)).status, "connected");
  return { adapter, config };
}

test("real stdio MCP initializes, advertises tools, calls, pings and disconnects", async (t) => {
  const { adapter } = await fixture(t);
  assert.ok(
    (await adapter.listTools()).some((tool) => tool.name === "echo" || tool.toolName === "echo"),
  );
  assert.equal(await adapter.pingServer("fixture"), true);
  const result = await adapter.callTool({
    serverName: "fixture",
    toolName: "echo",
    arguments: { text: "MYCODE_REAL_MCP_ECHO" },
  });
  assert.equal(result.content[0].text, "MYCODE_REAL_MCP_ECHO");
  assert.equal((await adapter.disconnectServer("fixture")).status, "disconnected");
  assert.deepEqual(await adapter.listTools(), []);
});

test("a timed-out MCP tool call leaves the connection available for the next call", async (t) => {
  const { adapter } = await fixture(t);
  await assert.rejects(
    adapter.callTool({ serverName: "fixture", toolName: "wait", arguments: {} }, { timeoutMs: 30 }),
    /timed out|timeout/i,
  );
  const result = await adapter.callTool({
    serverName: "fixture",
    toolName: "echo",
    arguments: { text: "AFTER_TIMEOUT" },
  });
  assert.equal(result.content[0].text, "AFTER_TIMEOUT");
  assert.equal((await adapter.status()).fixture.status, "connected");
});

test("a real MCP subprocess crash is observed and the next tool call reconnects", async (t) => {
  const { adapter } = await fixture(t);
  await adapter.callTool({ serverName: "fixture", toolName: "crash", arguments: {} });
  const deadline = Date.now() + 3000;
  while ((await adapter.status()).fixture.status === "connected" && Date.now() < deadline)
    await delay(10);
  assert.equal((await adapter.status()).fixture.status, "disconnected");
  const result = await adapter.callTool({
    serverName: "fixture",
    toolName: "echo",
    arguments: { text: "AFTER_CRASH" },
  });
  assert.equal(result.content[0].text, "AFTER_CRASH");
  assert.equal((await adapter.status()).fixture.status, "connected");
});

test("one caller's OAuth wait abort leaves the shared connection transaction alive", async () => {
  const adapter = new NodeMcpAdapter({});
  let finish;
  const connecting = new Promise((resolve) => {
    finish = resolve;
  });
  const owner = new AbortController();
  const status = {
    status: "connecting",
    transport: "http",
    toolCount: 0,
    updatedAt: new Date().toISOString(),
  };
  const record = {
    config: { type: "http", url: "https://example.invalid/mcp" },
    connecting,
    abortController: owner,
    status,
    tools: [],
  };
  adapter.records.set("shared", record);
  const caller = new AbortController();
  const waiting = adapter.waitForSharedConnection("shared", record, { signal: caller.signal });
  caller.abort();
  assert.equal(await waiting, status);
  assert.equal(owner.signal.aborted, false);
  assert.equal(adapter.records.get("shared").connecting, connecting);
  finish(status);
  await adapter.close();
});

test("a late failure from an old generation cannot replace the current connection", async () => {
  const adapter = new NodeMcpAdapter({});
  const config = { type: "http", url: "https://example.invalid/mcp" };
  const previous = adapter.nextConnectionGeneration("same");
  adapter.nextConnectionGeneration("same");
  const status = adapter.createStatus(config, "connected", { toolCount: 2 });
  const current = { config, status, tools: [] };
  adapter.records.set("same", current);
  const failed = await adapter.failConnection({
    config,
    generation: previous,
    name: "same",
    error: new Error("Old request failed"),
    startedAt: Date.now(),
  });
  assert.equal(failed, status);
  assert.equal(adapter.records.get("same"), current);
  await adapter.close();
});

test("ordinary stdio MCP never receives official identity metadata", async () => {
  const adapter = new NodeMcpAdapter({
    officialMcpAuth: {
      authHeadersPort: {
        resolveHeaders: () => assert.fail("Third-party MCP must not request official identity"),
      },
    },
  });
  assert.equal(
    await adapter.resolveOfficialStdioAuthMeta(
      "third-party",
      { type: "stdio", command: "unused" },
      undefined,
    ),
    undefined,
  );
  await adapter.close();
});
