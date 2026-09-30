import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationTopicPublisher } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/conversation-topic-publisher.ts";
import {
  createSessionEvent,
  SessionEventType,
} from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";

const event = (sequenceNumber, type, payload) => ({
  ...createSessionEvent(type, "delivery-test", payload, { turnId: "turn-1" }),
  sequenceNumber,
});
const title = (seq, value) =>
  event(seq, SessionEventType.SessionTitleUpdated, { title: value, source: "custom" });
const publisher = (options = {}) => {
  const result = new ConversationTopicPublisher("delivery-test", "epoch-1", {
    now: () => 123,
    ...options,
  });
  result.ingest(event(1, SessionEventType.SessionCreated, {}));
  return result;
};
const connect = (p, connectionId = "connection-1") => {
  const result = p.subscribeReserved({ connectionId });
  assert.equal(result.reservation.commit(), true);
  return result.ack.subscriptionId;
};

test("replacement rollback restores the original uncommitted reservation", () => {
  const p = publisher();
  const first = p.subscribeReserved({ connectionId: "connection-1" });
  const id = first.ack.subscriptionId;
  assert.equal(p.reserveFlush(id), first.reservation);
  const replacement = p.subscribeReserved({ connectionId: "connection-1" });
  assert.equal(p.hasSubscription(id), false);
  assert.equal(replacement.rollback(), true);
  assert.equal(p.hasSubscription(id, "connection-1"), true);
  assert.equal(replacement.reservation.commit(), false);
  assert.equal(first.reservation.commit(), true);
  assert.equal(p.flush(id), null);
});

test("same-sub recovery supersedes old frames and advances only after commit", () => {
  const p = publisher();
  const id = connect(p);
  p.ingest(title(2, "second"));
  const old = p.reserveFlush(id);
  const recovered = p.resyncReserved(id, { base: { logEpoch: "epoch-1", seq: 1 } });
  assert.equal(recovered.ack.mode, "resume");
  assert.equal(old.commit(), false);
  assert.equal(recovered.reservation.frame.fromSeq, 1);
  assert.equal(recovered.reservation.frame.toSeq, 2);
  assert.ok(recovered.reservation.logicalFrameOrdinal > old.logicalFrameOrdinal);
  assert.equal(recovered.reservation.commit(), true);
  assert.equal(recovered.rollback(), false);
  assert.equal(p.flush(id), null);
});

test("recovery rollback preserves events received while the recovery was pending", () => {
  const p = publisher();
  const id = connect(p);
  p.ingest(title(2, "second"));
  const old = p.reserveFlush(id);
  const recovered = p.resyncReserved(id, { base: null, forceSnapshot: true });
  p.ingest(title(3, "third"));
  assert.equal(recovered.rollback(), true);
  assert.equal(recovered.rollback(), true);
  assert.equal(recovered.reservation.commit(), false);
  assert.equal(p.reserveFlush(id), old);
  assert.equal(old.commit(), true);
  const next = p.flush(id);
  assert.equal(next.fromSeq, 2);
  assert.equal(next.toSeq, 3);
  assert.equal(next.payload.kind, "deltas");
  assert.ok(
    next.payload.deltas.some(
      (delta) => delta.op === "state.updated" && delta.patch.meta?.title === "third",
    ),
  );
});

test("overflow snapshots resync again when the projection advances during delivery", () => {
  const p = publisher({ subscriberBufferMaxOps: 0 });
  const id = connect(p);
  p.ingest(title(2, "second"));
  const snapshot = p.reserveFlush(id);
  assert.equal(snapshot.frame.payload.kind, "snapshot");
  p.ingest(title(3, "third"));
  assert.equal(snapshot.commit(), true);
  const next = p.flush(id);
  assert.equal(next.payload.kind, "snapshot");
  assert.equal(next.payload.snapshot.meta.title, "third");
  assert.equal(next.toSeq, 3);
  assert.equal(p.flush(id), null);
});

test("failed replay leaves the authoritative snapshot and pending frame intact", () => {
  const p = publisher();
  const id = connect(p);
  p.ingest(title(2, "live"));
  const pending = p.reserveFlush(id);
  const previous = structuredClone(p.getSnapshot());
  assert.throws(
    () =>
      p.rehydrate([title(1, "candidate"), event(2, SessionEventType.SessionTitleUpdated, null)]),
    TypeError,
  );
  assert.deepEqual(p.getSnapshot(), previous);
  assert.equal(p.reserveFlush(id), pending);
  assert.equal(pending.commit(), true);
});

test("successful replay adopts the new projection, invalidates old frames and forces snapshot recovery", () => {
  const p = publisher();
  const id = connect(p);
  p.ingest(title(2, "live"));
  const pending = p.reserveFlush(id);
  p.rehydrate([
    event(1, SessionEventType.SessionCreated, {}),
    title(2, "restored"),
    title(3, "final"),
  ]);
  assert.equal(pending.commit(), false);
  const next = p.flush(id);
  assert.equal(next.payload.kind, "snapshot");
  assert.equal(next.payload.snapshot.meta.title, "final");
  assert.equal(next.toSeq, 3);
  const late = p.subscribeReserved({ connectionId: "late", base: { logEpoch: "epoch-1", seq: 2 } });
  assert.equal(late.ack.mode, "snapshot");
  assert.equal(late.reservation.frame.payload.snapshot.meta.title, "final");
  assert.ok(p.getWireSnapshotLogicalBytes() > 0);
});

test("retained-log boundary selects resume or snapshot and isolates connection ownership", () => {
  const p = publisher({ retention: 2 });
  p.ingest(title(2, "second"));
  p.ingest(title(3, "third"));
  const resumed = p.subscribeReserved({
    connectionId: "one",
    base: { logEpoch: "epoch-1", seq: 1 },
  });
  assert.equal(resumed.ack.mode, "resume");
  assert.equal(resumed.reservation.frame.fromSeq, 1);
  const expired = p.subscribeReserved({
    connectionId: "two",
    base: { logEpoch: "epoch-1", seq: 0 },
  });
  assert.equal(expired.ack.mode, "snapshot");
  p.unsubscribe(resumed.ack.subscriptionId, "two");
  assert.equal(p.hasSubscription(resumed.ack.subscriptionId, "one"), true);
  p.unsubscribe(resumed.ack.subscriptionId, "one");
  assert.equal(resumed.reservation.commit(), false);
  assert.equal(expired.reservation.commit(), true);
});
