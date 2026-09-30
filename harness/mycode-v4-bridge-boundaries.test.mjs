import assert from "node:assert/strict";
import { test } from "node:test";
import { createV4QueueAutoDrain } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/v4-bridge-auto-drain.ts";
import { createV4InputLedger } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/v4-bridge-input-ledger.ts";
import { createV4SessionLifecycle } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/v4-bridge-session-lifecycle.ts";
import { createV4ColdHydration } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/v4-bridge-cold-hydration.ts";
import { createStoredSessionSummariesLoader } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol/v4-bridge-stored-summaries.ts";
const admission = { queueItemId: "q-1", admissionSeq: 1, admittedAt: 100 };
const command = {
  type: "sendText",
  commandId: "c-1",
  clientId: "test",
  sessionId: "s-1",
  payload: { text: "hello", attachments: [] },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const context = () => ({ deps: {}, sessions: new Map(), logger: { warn() {}, info() {} } });

test("auto-drain retries once while busy and resolves the current executor when idle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = context(),
    done = deferred(),
    head = { autoDrain: true, dispatchState: "queued", kind: "sendText", queueItemId: "q-1" };
  let busy = true,
    oldCalls = 0,
    newCalls = 0;
  const record = {
    app: {
      sessionId: "s-1",
      runtime: { getActiveForegroundExecutionId: () => (busy ? "run" : undefined) },
      readTarget: async () => null,
    },
  };
  ctx.sessions.set("s-1", record);
  ctx.v4Gateway = { getQueueHead: () => head };
  let executor = {
    execute: async () => {
      oldCalls++;
    },
  };
  const drain = createV4QueueAutoDrain(ctx, () => executor);
  await drain(record);
  await drain(record);
  assert.equal(oldCalls, 0);
  busy = false;
  executor = {
    execute: async (envelope, _admission, options) => {
      newCalls++;
      assert.equal(envelope.payload.queueItemId, "q-1");
      assert.equal(options.autoDrainPromotion, true);
      done.resolve();
    },
  };
  t.mock.timers.tick(100);
  await done.promise;
  assert.equal(newCalls, 1);
  assert.equal(oldCalls, 0);
});

test("auto-drain ignores a replaced session record and pauses a failed promotion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = context(),
    head = { autoDrain: true, dispatchState: "queued", kind: "sendText", queueItemId: "q-1" },
    pauses = [];
  let busy = true,
    calls = 0;
  const record = {
    app: {
      sessionId: "s-1",
      runtime: { getActiveForegroundExecutionId: () => (busy ? "run" : undefined) },
      readTarget: async () => null,
      setQueueAutoDrain: async (value) => {
        pauses.push(value);
      },
    },
  };
  ctx.sessions.set("s-1", record);
  ctx.v4Gateway = { getQueueHead: () => head };
  const drain = createV4QueueAutoDrain(ctx, () => ({
    execute: async () => {
      calls++;
      throw Error("promotion failed");
    },
  }));
  await drain(record);
  ctx.sessions.set("s-1", { ...record });
  busy = false;
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(calls, 0);
  ctx.sessions.set("s-1", record);
  await drain(record);
  assert.equal(calls, 1);
  assert.deepEqual(pauses, [false]);
});

test("draft admission persists the session before the ledger and records attachment fallback", async () => {
  const ctx = context(),
    order = [],
    saved = [];
  const record = {
    persistence: "deferred",
    traceContext: { traceId: "trace" },
    app: {
      runtime: {
        ensureSessionPersistedForExternalActivity: async () => {
          order.push("session");
        },
      },
    },
  };
  ctx.sessions.set("s-1", record);
  ctx.v4Gateway = { getInputRoutingMode: () => "guide" };
  ctx.deps.sessionStore = {
    saveSessionInput: async (input) => {
      order.push("input");
      saved.push(input);
    },
  };
  const ledger = createV4InputLedger(ctx, {});
  const attachment = { ref: "a-1", fileName: "note.txt", mime: "text/plain", bytes: 4 };
  const intent = await ledger.admitInputCommand(
    { ...command, payload: { text: "hello", attachments: [attachment] } },
    "s-1",
    admission,
  );
  assert.deepEqual(order, ["session", "input"]);
  assert.equal(record.persistence, "immediate");
  assert.equal(intent.delivery.admitted, "queue");
  assert.equal(intent.delivery.fallbackReasonCode, "guide.attachmentsUnsupported");
  assert.equal(saved[0].payload.conversationInputIntent.queueItemId, "q-1");
});

test("failed shared-context reservation settles the admitted input before rejecting", async () => {
  const ctx = context(),
    order = [];
  ctx.v4Gateway = { getInputRoutingMode: () => "enqueue" };
  ctx.deps.sessionStore = {
    saveSessionInput: async () => {
      order.push("saved");
    },
    transitionSharedContextImport: async () => {
      order.push("reserved");
      return false;
    },
    settleSessionInput: async (input) => {
      order.push(input.status);
      assert.equal(input.reason, "shared_context_not_attachable");
    },
  };
  const ledger = createV4InputLedger(ctx, {});
  await assert.rejects(
    ledger.admitInputCommand(
      {
        ...command,
        payload: {
          text: "hello",
          context_refs: [{ kind: "shared_context_import", context_id: "shared-1" }],
        },
      },
      "s-1",
      admission,
    ),
    /sharedContextNotAttachable/,
  );
  assert.deepEqual(order, ["saved", "reserved", "failed"]);
});

test("input cancellation releases only its own reserved shared context", async () => {
  const ctx = context(),
    transitions = [],
    settled = [];
  ctx.deps.sessionStore = {
    settleSessionInput: async (input) => settled.push(input),
    sessionEntries: async () => [
      { data: { status: "reserved", sourceId: "other", contextId: "other-context" } },
      { data: { status: "reserved", sourceId: "q-1", contextId: "own-context" } },
    ],
    transitionSharedContextImport: async (input) => {
      transitions.push(input);
      return true;
    },
  };
  await createV4InputLedger(ctx, {}).cancelInputCommand("s-1", "q-1", "cancelled by user");
  assert.equal(settled[0].status, "cancelled");
  assert.deepEqual(transitions, [
    {
      sessionID: "s-1",
      contextId: "own-context",
      expectedStatus: "reserved",
      status: "pending",
      sourceId: "q-1",
    },
  ]);
});

test("close disposes the publisher while workspace registration still exists", async () => {
  const ctx = context(),
    order = [];
  ctx.sessions.set("s-1", {
    unsubscribe: () => order.push("unsubscribe"),
    app: { close: async () => order.push("close") },
  });
  ctx.v4Gateway = {
    disposeSession: (id) => {
      assert.equal(ctx.sessions.has(id), true);
      order.push("dispose");
    },
  };
  const lifecycle = createV4SessionLifecycle(ctx, async () => {});
  await lifecycle.closeSession("s-1");
  await lifecycle.closeSession("s-1");
  assert.deepEqual(order, ["unsubscribe", "close", "dispose"]);
  assert.equal(ctx.sessions.has("s-1"), false);
});

test("cold hydration with no backing runtime remains explicitly unsynthesized", async () => {
  const ctx = context(),
    warnings = [];
  ctx.logger.warn = (message, fields) => warnings.push(fields);
  ctx.deps.sessionStore = { getSession: async () => ({ parentID: "missing-parent" }) };
  const result = await createV4ColdHydration(ctx).loadPersistedEvents("detached-child");
  assert.deepEqual(result, { events: [], synthesized: false, sourceEventSeq: 0 });
  assert.equal(warnings[0].sessionId, "detached-child");
  assert.equal(warnings[0].phase, "loadPersistedEvents");
});

test("stored summaries keep remote identity filtering after legacy claim failure", async () => {
  const ctx = context(),
    claims = [],
    queries = [];
  ctx.deps.sessionStore = {
    claimLegacySessionWorkspace: async (input) => {
      claims.push(input);
      throw Error("claim failed");
    },
    listSessions: async (input) => {
      queries.push(input);
      return [];
    },
  };
  const workspace = "remote:ssh:example.invalid:22:tester:/workspace/project";
  await createStoredSessionSummariesLoader(ctx)(workspace, ["task-a"]);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].sessionIDs, ["task-a"]);
  assert.equal(queries[0].workspaceID, workspace);
  assert.equal(queries[0].directory, "/workspace/project");
  assert.equal(queries[0].includeArchived, false);
});
