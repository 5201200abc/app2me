import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { WorkflowEngine } from "../apps/mycode-cli/packages/dynamic-workflow/src/engine/engine.ts";
import { InMemoryJournalStore } from "../apps/mycode-cli/packages/dynamic-workflow/src/engine/journal-memory.ts";
import { ImportedActorState } from "../apps/mycode-cli/packages/dynamic-workflow/src/engine/imported-cache.ts";
import { retuneRunConcurrency } from "../apps/mycode-cli/packages/bootstrap/src/app/dynamic-workflow-run-retune.ts";
import { reconcileOrphanRuns } from "../apps/mycode-cli/packages/bootstrap/src/app/dynamic-workflow-run-reconcile.ts";

// Controlled driver tests exercise scheduling and journal contracts; these are not model-service tests.
test("retuning a live run dispatches queued asks immediately and lowering it preserves in-flight asks", async () => {
  const journal = new InMemoryJournalStore(),
    started = [],
    cancelled = [],
    events = [];
  const caps = { maxConcurrency: 1 };
  const engine = new WorkflowEngine({
    runId: "retune-run",
    caps,
    askSpecs: new Map([["ask", { typed: false }]]),
    validate: () => ({ ok: true }),
    driver: {
      journal,
      createActorSession: async (actor) => ({ id: `actor-${actor.ordinal}` }),
      startAsk: (session, instance) => {
        assert.match(session.id, /^actor-\d+$/);
        started.push(instance);
      },
      respondToSubmit() {},
      cancelAsk: (instance) => cancelled.push(instance),
      executeWorldRead: async () => null,
      emit: (event) => events.push(event),
    },
  });
  const entry = {
    maxConcurrency: 1,
    control: { setMaxConcurrency: (value) => engine.setMaxConcurrency(value) },
  };
  const ctx = { runs: new Map([["retune-run", entry]]), journal, concurrencyCeiling: () => 8 };
  const actors = Array.from({ length: 4 }, (_, n) => engine.createActor("actor", `worker-${n}`));
  const asks = actors.map((actor) => engine.ask("ask", actor, "work"));
  await nextTurn();
  assert.equal(started.length, 1);
  assert.deepEqual(retuneRunConcurrency(ctx, { runId: "retune-run", maxConcurrency: 3 }), {
    ok: true,
    maxConcurrency: 3,
    previous: 1,
    ceiling: 8,
  });
  await nextTurn();
  assert.equal(started.length, 3);
  assert.equal(journal.getRun("retune-run").caps.maxConcurrency, 3);
  assert.equal(entry.maxConcurrency, 3);
  assert.equal(caps.maxConcurrency, 1);
  assert.equal(retuneRunConcurrency(ctx, { runId: "retune-run", maxConcurrency: 1 }).ok, true);
  assert.equal(cancelled.length, 0);
  engine.askTurnEnded(started[0], "one");
  await nextTurn();
  assert.equal(started.length, 3);
  engine.askTurnEnded(started[1], "two");
  await nextTurn();
  assert.equal(started.length, 3);
  engine.askTurnEnded(started[2], "three");
  await nextTurn();
  assert.equal(started.length, 4);
  engine.askTurnEnded(started[3], "four");
  assert.deepEqual(await Promise.all(asks), ["one", "two", "three", "four"]);
  engine.complete("done");
  await engine.settled;
  assert.equal(engine.setMaxConcurrency(7), false);
  assert.equal(journal.getRun("retune-run").caps.maxConcurrency, 1);
  assert.equal(events.filter((event) => event.type === "run-caps-changed").length, 2);
  assert.equal(cancelled.length, 0);
});

test("retune clamps to the host ceiling and leaves dead, unchanged and raced entries untouched", () => {
  const changes = [],
    entry = {
      maxConcurrency: 2,
      control: {
        setMaxConcurrency: (value) => {
          changes.push(value);
          return true;
        },
      },
    };
  const ctx = {
    runs: new Map([["run", entry]]),
    journal: { getRun: () => undefined },
    concurrencyCeiling: () => 4,
  };
  assert.equal(retuneRunConcurrency(ctx, { runId: "run", maxConcurrency: 100 }).maxConcurrency, 4);
  assert.deepEqual(retuneRunConcurrency(ctx, { runId: "run", maxConcurrency: null }), {
    ok: false,
    reason: "unchanged",
    current: 4,
  });
  entry.control.setMaxConcurrency = () => false;
  assert.deepEqual(retuneRunConcurrency(ctx, { runId: "run", maxConcurrency: 1 }), {
    ok: false,
    reason: "not_live",
    current: 4,
  });
  assert.equal(entry.maxConcurrency, 4);
  entry.terminal = { status: "completed" };
  assert.deepEqual(retuneRunConcurrency(ctx, { runId: "run", maxConcurrency: 1 }), {
    ok: false,
    reason: "not_live",
  });
  assert.deepEqual(changes, [4]);
});
const candidate = () => ({
  persona: { name: "worker" },
  transcriptSourceSessionId: "source-session",
  resolvedModel: "deepseek/flash",
  entries: [
    { inputHash: "a", result: "first", messageBoundary: 2, stats: { worldToolCalls: 0 } },
    { inputHash: "b", result: "second", messageBoundary: 4, stats: { worldToolCalls: 1 } },
    { inputHash: "c", result: "third", messageBoundary: 6, stats: { worldToolCalls: 0 } },
  ],
});
test("closing import reuse keeps pure cached asks but permanently invalidates a world-dependent suffix", () => {
  const state = new ImportedActorState(candidate());
  assert.equal(state.takeIfPure(0, "a").result, "first");
  assert.equal(state.takeIfPure(1, "b"), undefined);
  assert.equal(state.takeIfPure(2, "c"), undefined);
  assert.equal(state.seed().messageCount, 2);
});
test("reconstructed divergence cannot resurrect a later matching ask after a crash", () => {
  const state = new ImportedActorState(candidate());
  state.reconcileRecorded(0, "a", false, true);
  state.reconcileRecorded(1, "b", true, false);
  assert.equal(state.take(2, "c"), undefined);
  assert.equal(state.seed().messageCount, 2);
});
test("an unchanged in-flight predecessor resumes its transcript only while import remains open", () => {
  const base = {
    ...candidate(),
    entries: [],
    inFlight: { inputHash: "pending", messageBoundary: 5 },
  };
  const open = new ImportedActorState(base);
  assert.equal(open.take(0, "pending"), undefined);
  assert.equal(open.carriedAt(0), true);
  assert.equal(open.seed().messageCount, 5);
  const closed = new ImportedActorState(base);
  assert.equal(closed.takeIfPure(0, "pending"), undefined);
  assert.equal(closed.carriedAt(0), false);
  assert.equal(closed.seed(), undefined);
});
test("orphan recovery affects only the requested parent and remains idempotent without synthetic events", () => {
  const rows = [
      { runId: "orphan", parentSessionId: "parent", status: "running" },
      { runId: "finished", parentSessionId: "parent", status: "completed" },
      { runId: "sibling", parentSessionId: "other", status: "running" },
    ],
    updates = [];
  const journal = {
    listNonTerminalRuns: (parent) =>
      rows.filter((row) => row.parentSessionId === parent && row.status === "running"),
    updateRunStatus: (id, status, settlement) => {
      rows.find((row) => row.runId === id).status = status;
      updates.push({ id, status, settlement });
    },
    appendEvent: () => assert.fail("reconciliation must not synthesize engine events"),
  };
  reconcileOrphanRuns({ journal, parentSessionId: "parent" });
  reconcileOrphanRuns({ journal, parentSessionId: "parent" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "stopped");
  assert.equal(updates[0].settlement.stopReason, "interrupted");
  assert.equal(rows[2].status, "running");
});
test("orphan storage failure is reported without crashing app startup", () => {
  const warnings = [];
  assert.doesNotThrow(() =>
    reconcileOrphanRuns({
      parentSessionId: "parent",
      journal: {
        listNonTerminalRuns: () => {
          throw Error("storage offline");
        },
      },
      logger: { warn: (...args) => warnings.push(args) },
    }),
  );
  assert.equal(warnings.length, 1);
});
