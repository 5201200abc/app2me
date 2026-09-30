import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationV4Gateway } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/v4-gateway.ts";
import { SessionEventType as E } from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";
const event = (
  seq,
  type = E.SessionTitleUpdated,
  payload = { title: `title-${seq}`, source: "custom" },
) => ({
  id: `e-${seq}`,
  sessionId: "s-1",
  traceId: "trace-test",
  turnId: "turn-1",
  timestamp: new Date(1000 + seq),
  sequenceNumber: seq,
  type,
  payload,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(t, overrides = {}) {
  const frames = [],
    errors = [];
  const host = {
    sessionExists: () => true,
    emitWireFrame: (frame) => frames.push(frame),
    executeCommand: async () => undefined,
    onError: (...error) => errors.push(error),
    ...overrides,
  };
  const gateway = new ConversationV4Gateway(host, {
    now: () => 1000,
    createLogEpoch: () => "epoch",
  });
  t.after(() => gateway.dispose());
  return { gateway, host, frames, errors };
}
const subscribe = (gateway, connectionId, clientMode = "desktop-continuous") =>
  gateway.subscribeReserved({ topic: "conversation/s-1", connectionId, clientMode });
const command = (id) => ({
  commandId: id,
  clientId: "client-1",
  sessionId: "s-1",
  baseRevision: 0,
  issuedAt: 1000,
  type: "sendText",
  payload: { text: "test", attachments: [] },
});

for (const mode of ["desktop-continuous", "web-remote-replayable"])
  test(`${mode} keeps initial frames reserved until ACK and flushes later deltas`, async (t) => {
    const { gateway, frames } = fixture(t);
    gateway.ingest("s-1", event(1, E.SessionCreated, {}));
    const dispatch = await subscribe(gateway, "connection-1", mode);
    assert.equal(dispatch.initialFrame.payload.kind, "snapshot");
    assert.ok(dispatch.initialWires.length > 0);
    gateway.ingest("s-1", event(2));
    gateway.flushNow(dispatch.ack.subscriptionId);
    assert.equal(frames.length, 0);
    assert.equal(dispatch.commit(), true);
    const next = gateway.flushNow(dispatch.ack.subscriptionId);
    assert.ok(next);
    assert.equal(next.payload.kind, "deltas");
    assert.equal(next.toSeq, 2);
  });

test("saturation is isolated per connection and draining resumes the pending stream", async (t) => {
  const { gateway, frames } = fixture(t);
  gateway.ingest("s-1", event(1, E.SessionCreated, {}));
  const first = await subscribe(gateway, "first"),
    second = await subscribe(gateway, "second");
  first.commit();
  second.commit();
  gateway.setConnectionFlowState({ connectionId: "first", state: "saturated" });
  gateway.ingest("s-1", event(2));
  gateway.setConnectionFlowState({ connectionId: "second", state: "saturated" });
  gateway.setConnectionFlowState({ connectionId: "second", state: "drained" });
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => frame.subscriptionId === second.ack.subscriptionId));
  frames.length = 0;
  gateway.setConnectionFlowState({ connectionId: "first", state: "drained" });
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => frame.subscriptionId === first.ack.subscriptionId));
});

test("projection commit waits for the missing raw event and disposal rejects pending waiters", async (t) => {
  const { gateway } = fixture(t);
  gateway.ingest("s-1", event(1, E.SessionCreated, {}));
  let committed = false;
  const wait = gateway.waitForProjectionEventCommit("s-1", "e-3").then(() => {
    committed = true;
  });
  gateway.ingest("s-1", event(3));
  await Promise.resolve();
  assert.equal(committed, false);
  gateway.ingest("s-1", event(2));
  await wait;
  assert.equal(committed, true);
  const pending = gateway.waitForProjectionEventCommit("s-1", "e-missing");
  const rejected = assert.rejects(
    pending,
    (error) => error.reasonCode === "fault.projectionEventCommit.disposed",
  );
  gateway.disposeSession("s-1");
  await rejected;
});

test("concurrent subscriptions share hydration and preserve live events arriving during load", async (t) => {
  const load = deferred(),
    started = deferred();
  let loads = 0;
  const { gateway } = fixture(t, {
    loadPersistedEvents: async () => {
      loads++;
      started.resolve();
      return load.promise;
    },
  });
  gateway.ingest("s-1", event(1, E.SessionCreated, {}));
  const first = subscribe(gateway, "first"),
    second = subscribe(gateway, "second");
  await started.promise;
  gateway.ingest("s-1", event(2));
  load.resolve({ events: [event(1, E.SessionCreated, {})], synthesized: true, sourceEventSeq: 1 });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(loads, 1);
  for (const dispatch of [a, b]) {
    assert.equal(dispatch.initialFrame.toSeq, 2);
    assert.equal(dispatch.initialFrame.payload.snapshot.meta.title, "title-2");
    dispatch.commit();
  }
});

test("disposal during hydration prevents late resurrection of a publisher", async (t) => {
  const load = deferred(),
    started = deferred();
  const { gateway } = fixture(t, {
    loadPersistedEvents: async () => {
      started.resolve();
      return load.promise;
    },
  });
  const pending = subscribe(gateway, "first");
  await started.promise;
  gateway.disposeSession("s-1");
  const rejected = assert.rejects(pending, /hydration cancelled/);
  load.resolve({ events: [], synthesized: true, sourceEventSeq: 0 });
  await rejected;
  assert.equal(gateway.hasConversationSubscribers("s-1"), false);
});

test("duplicate commands execute once and execution failure releases the session FIFO", async (t) => {
  const barrier = deferred(),
    started = deferred();
  let executions = 0;
  const { gateway } = fixture(t, {
    executeCommand: async (envelope) => {
      executions++;
      if (envelope.commandId === "one") {
        started.resolve();
        await barrier.promise;
        throw Object.assign(new Error("expected failure"), { reasonCode: "fault.test" });
      }
    },
    onError: () => {
      throw Error("observer failure");
    },
  });
  const first = gateway.handleCommand(command("one"));
  await started.promise;
  const duplicate = gateway.handleCommand(command("one"));
  barrier.resolve();
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(a.status, "failed");
  assert.equal(a.reasonCode, "fault.test");
  assert.deepEqual(a, b);
  assert.equal(executions, 1);
  const next = await gateway.handleCommand(command("two"));
  assert.equal(next.status, "accepted");
  assert.equal(executions, 2);
});
