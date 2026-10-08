import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionEvent,
  SessionEventType as E,
} from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";
import { checkpointCreatedPayloadSchema } from "../apps/mycode-cli/packages/contracts/src/rewind/index.ts";
import { ProductProjection } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/product-projection.ts";
import { ConversationV4Gateway } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/v4-gateway.ts";
import { emitFileMutationCheckpoint } from "../apps/mycode-cli/packages/core/src/runtime/methods/tools.ts";

const event = (type, payload, sequenceNumber, turnId = "turn-1") => ({
  ...createSessionEvent(type, "changes-test", payload, { turnId }),
  sequenceNumber,
});
const checkpoint = (fileChanges) => ({
  checkpointId: "checkpoint",
  messageId: "message",
  scope: "workspace",
  snapshotRef: "artifact:checkpoint",
  fileCount: 1,
  ...(fileChanges ? { fileChanges } : {}),
});
const header = (projection) =>
  projection.getSnapshot().rows.window.find((row) => row.kind === "turnHeader");
const start = () => [
  event(E.SessionCreated, { mode: "default" }, 1),
  event(E.TurnStarted, { input: "create", turnNumber: 1 }, 2),
];

for (const clientMode of ["desktop-continuous", "web-remote-replayable"])
  test(`${clientMode} delivers checkpoint counts before the model finishes`, async (t) => {
    const gateway = new ConversationV4Gateway(
      {
        sessionExists: () => true,
        emitWireFrame: () => undefined,
        executeCommand: async () => undefined,
        onError: (error) => {
          throw error;
        },
      },
      { createLogEpoch: () => "epoch" },
    );
    t.after(() => gateway.dispose());
    for (const item of start()) gateway.ingest("changes-test", item);
    const connected = await gateway.subscribeReserved({
      topic: "conversation/changes-test",
      connectionId: "connection",
      clientMode,
    });
    assert.equal(connected.commit(), true);
    gateway.ingest(
      "changes-test",
      event(E.CheckpointCreated, checkpoint({ files: 1, additions: 453, deletions: 7 }), 3),
    );
    const frame = gateway.flushNow(connected.ack.subscriptionId);
    assert.equal(frame.payload.kind, "deltas");
    assert.deepEqual(
      frame.payload.deltas.find(
        (delta) => delta.op === "row.upserted" && delta.row.kind === "turnHeader",
      ).row.fileChanges,
      { files: 1, additions: 453, deletions: 7, state: "active" },
    );
    assert.equal(frame.toSeq, 3);
  });

test("checkpoint counts update before ModelComplete and survive replay, without accumulating successive totals", () => {
  const events = [
    ...start(),
    event(E.CheckpointCreated, checkpoint({ files: 1, additions: 12, deletions: 3 }), 3),
    event(E.CheckpointCreated, checkpoint({ files: 1, additions: 4, deletions: 1 }), 4),
  ];
  const live = new ProductProjection("changes-test", "epoch");
  for (const item of events.slice(0, 3)) live.applyEvent(item);
  assert.deepEqual(header(live).fileChanges, {
    files: 1,
    additions: 12,
    deletions: 3,
    state: "active",
  });
  live.applyEvent(events[3]);
  assert.deepEqual(header(live).fileChanges, {
    files: 1,
    additions: 4,
    deletions: 1,
    state: "active",
  });
  const replay = new ProductProjection("changes-test", "epoch");
  replay.beginHydrationReplay();
  for (const item of events) replay.applyHydrationEvent(item);
  replay.completeHydrationReplay();
  assert.deepEqual(header(replay).fileChanges, header(live).fileChanges);
});

test("legacy checkpoints remain valid and late or cancelled checkpoints cannot overwrite counts", () => {
  assert.equal(checkpointCreatedPayloadSchema.safeParse(checkpoint()).success, true);
  assert.equal(
    checkpointCreatedPayloadSchema.safeParse(checkpoint({ files: 1, additions: -1, deletions: 0 }))
      .success,
    false,
  );
  const projection = new ProductProjection("changes-test", "epoch");
  for (const item of start()) projection.applyEvent(item);
  projection.applyEvent(
    event(E.CheckpointCreated, checkpoint({ files: 1, additions: 2, deletions: 1 }), 3),
  );
  projection.applyEvent(
    event(
      E.CheckpointCreated,
      checkpoint({ files: 1, additions: 100, deletions: 0 }),
      4,
      "old-turn",
    ),
  );
  assert.equal(header(projection).fileChanges.additions, 2);
  projection.applyEvent(event(E.TurnError, { error: "cancelled", errorType: "cancelled" }, 5));
  projection.applyEvent(
    event(E.CheckpointCreated, checkpoint({ files: 1, additions: 200, deletions: 0 }), 6),
  );
  assert.equal(header(projection).fileChanges.additions, 2);
});

test("runtime publishes net counts only after successful persistence, including edits that undo previous edits", async () => {
  const events = [];
  let fail = false;
  const owner = {
    sessionId: "changes-test",
    currentTurnFileChanges: new Map(),
    artifactStore: { writeToolResultArtifact: async () => ({ uri: "artifact:checkpoint" }) },
    createEvent: (type, payload) => event(type, payload, events.length + 3),
    appendEvent: async (value) => {
      if (fail) throw new Error("persist failed");
      events.push(value);
    },
  };
  const write = (originalFile, content, success = true) =>
    emitFileMutationCheckpoint.call(owner, {
      events: [],
      messageId: "message",
      traceContext: { turnId: "turn-1" },
      result: {
        success,
        toolCallId: "tool",
        toolName: "Write",
        output: { filePath: "/repo/app.ts", originalFile, content, structuredPatch: [] },
      },
    });
  await write("old\n", "new\nextra\n");
  assert.deepEqual(events[0].payload.fileChanges, { files: 1, additions: 2, deletions: 1 });
  await write("new\nextra\n", "old\n");
  assert.deepEqual(events[1].payload.fileChanges, { files: 1, additions: 0, deletions: 0 });
  fail = true;
  await write("old\n", "failed\n");
  await write("old\n", "failed tool\n", false);
  assert.equal(events.length, 2);
  assert.equal(owner.currentTurnFileChanges.get("/repo/app.ts").afterContent, "old\n");
});
