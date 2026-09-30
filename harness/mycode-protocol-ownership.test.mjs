import assert from "node:assert/strict";
import { test } from "node:test";
import { ProtocolClientRequests } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/client-requests.ts";
import { ProtocolOperationCancellation } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/operation-cancellation.ts";
import { MyCodeProtocolAgentServer } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/server.ts";
import { dispatchProtocolRequest } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/request-dispatch.ts";
import { V4_METHODS } from "../packages/shared/src/mycode-protocol-v4/index.ts";
import { mycodeProtocolMethods } from "../packages/shared/src/index.ts";

const schema = {
  parse: (value) => {
    if (typeof value !== "string") throw new Error("Expected text");
    return value;
  },
};
const request = (operationId) => ({ id: operationId, params: { operationId } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("reannounced client requests share a result and remove every alias and timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new ProtocolClientRequests();
  const sent = [];
  client.setNotificationSink((message) => sent.push(message));
  const pending = client.requestClient("test/reverse", {}, schema, { reannounceIntervalMs: 10 });
  t.mock.timers.tick(10);
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0].id, sent[1].id);
  client.resolveClientRequest(sent[1].id, "accepted");
  client.rejectClientRequest(sent[0].id, new Error("stale alias"));
  t.mock.timers.tick(1000);
  assert.equal(sent.length, 2);
  return assert.doesNotReject(async () => assert.equal(await pending, "accepted"));
});

test("client timeout, abort and malformed result each settle and stop reannouncement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new ProtocolClientRequests();
  const sent = [];
  client.setNotificationSink((message) => sent.push(message));
  const pending = client.requestClient("test/timeout", {}, schema, {
    timeoutMs: 15,
    reannounceIntervalMs: 10,
  });
  const rejected = assert.rejects(pending, (error) => error.code === -32022);
  t.mock.timers.tick(15);
  await rejected;
  const count = sent.length;
  t.mock.timers.tick(1000);
  assert.equal(sent.length, count);
  const abort = new AbortController();
  const cancelled = client.requestClient("test/abort", {}, schema, { signal: abort.signal });
  const cancellation = assert.rejects(cancelled, (error) => error.code === -32021);
  abort.abort();
  await cancellation;
  const malformed = client.requestClient("test/schema", {}, schema);
  const invalid = assert.rejects(malformed, /Expected text/);
  client.resolveClientRequest(sent.at(-1).id, 123);
  await invalid;
});

test("disconnect rejects all pending requests and reconnect accepts a fresh request", async () => {
  const client = new ProtocolClientRequests();
  const sent = [];
  client.setNotificationSink((message) => sent.push(message));
  const error = new Error("connection closed");
  const one = assert.rejects(
    client.requestClient("test/one", {}, schema),
    (cause) => cause === error,
  );
  const two = assert.rejects(
    client.requestClient("test/two", {}, schema),
    (cause) => cause === error,
  );
  client.disconnectClient(error);
  await Promise.all([one, two]);
  assert.throws(
    () => client.requestClient("test/closed", {}, schema),
    (cause) => cause === error,
  );
  client.setNotificationSink((message) => sent.push(message));
  const pending = client.requestClient("test/new", {}, schema);
  client.resolveClientRequest(sent.at(-1).id, "new result");
  assert.equal(await pending, "new result");
});

test("workspace operation ids stay exclusive until completion and become reusable", async () => {
  const operations = new ProtocolOperationCancellation();
  const done = deferred();
  let signal;
  const pending = operations.withWorkspaceGenerateTextSignal(
    request("workspace-one"),
    (current) => {
      signal = current;
      return done.promise;
    },
  );
  await assert.rejects(
    operations.withWorkspaceGenerateTextSignal(request("workspace-one"), async () => "duplicate"),
    (error) => error.code === -32600,
  );
  assert.equal(
    operations.cancelWorkspaceGenerateText({ operationId: "workspace-one" }).cancelled,
    true,
  );
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "AbortError");
  done.resolve("cancelled by handler");
  await pending;
  assert.equal(
    await operations.withWorkspaceGenerateTextSignal(
      request("workspace-one"),
      async () => "reused",
    ),
    "reused",
  );
});

test("an old plugin completion cannot release the replacement operation controller", async () => {
  const operations = new ProtocolOperationCancellation();
  const oldDone = deferred();
  const newDone = deferred();
  const old = operations.withPluginOperationSignal(request("same"), () => oldDone.promise);
  let latest;
  const current = operations.withPluginOperationSignal(request("same"), (signal) => {
    latest = signal;
    return newDone.promise;
  });
  oldDone.resolve();
  await old;
  assert.equal(operations.cancelPluginOperation({ operationId: "same" }).cancelled, true);
  assert.equal(latest.aborted, true);
  newDone.resolve();
  await current;
});

test("subscribe dispatch retains initial frames for the post-response commit", async () => {
  let commits = 0;
  const ack = { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" };
  const wire = { topic: "conversation/test", payload: "physical frame" };
  const postResponseOutbox = new Map();
  const context = {
    v4Gateway: {
      subscribeReserved: async () => ({
        ack,
        initialWires: [wire],
        commit: () => {
          commits++;
        },
      }),
    },
  };
  const result = await dispatchProtocolRequest(
    { context, postResponseOutbox, operations: new ProtocolOperationCancellation() },
    {
      id: "subscribe-1",
      method: V4_METHODS.conversationSubscribe,
      params: { topic: "conversation/test" },
    },
  );
  assert.deepEqual(result, { ack });
  assert.equal(commits, 0);
  const batch = postResponseOutbox.get("subscribe-1");
  assert.equal(batch.messages[0].params, wire);
  batch.commit();
  assert.equal(commits, 1);
});

test("server routes reverse replies and rejects pending work during idempotent shutdown", async () => {
  const server = new MyCodeProtocolAgentServer({
    createMyCodeApp: () => {
      throw new Error("No session should be created");
    },
    env: {},
  });
  const sent = [];
  server.setNotificationSink((message) => sent.push(message));
  assert.deepEqual(
    await server.handleMessage({
      id: 1,
      method: mycodeProtocolMethods.runtimeCapabilities,
      params: {},
    }),
    { id: 1, result: { independentPlanState: true } },
  );
  const pending = server.officialMcpAuthRequestContext.requestClient("test/reverse", {}, schema);
  await server.handleMessage({ id: sent.at(-1).id, result: "reply" });
  assert.equal(await pending, "reply");
  const closed = assert.rejects(
    server.officialMcpAuthRequestContext.requestClient("test/wait", {}, schema),
    /runtime stopping/,
  );
  const stopping = server.shutdown();
  assert.equal(server.shutdown(), stopping);
  await closed;
  await stopping;
  server.disposeProjections();
});
