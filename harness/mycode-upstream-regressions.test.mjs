import assert from "node:assert/strict";
import { test } from "node:test";
import { EventReducer } from "../apps/mycode-cli/packages/contracts/src/events/event-reducer.ts";
import {
  createSessionEvent,
  SessionEventType,
} from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";
import { indexDurableCompactionParts } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/transcript-hydration-compaction-index.ts";
import { ConversationTelemetryFactNormalizer } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/conversation-telemetry-facts.ts";

const event = (type, payload, turnId = "turn-1") =>
  createSessionEvent(type, "session-regression", payload, { turnId });

test("a new accepted turn clears a previous provider error, including after replay", () => {
  const reducer = new EventReducer();
  const attribution = {
    source: "provider",
    providerId: "deepseek",
    modelId: "deepseek-flash",
    transport: "http",
    statusCode: 429,
  };
  const error = {
    type: "provider_error",
    code: "rate_limit",
    message: "Too many requests",
    detail: "Retry later",
    attribution,
  };
  const events = [
    event(SessionEventType.SessionCreated, { mode: "default" }),
    event(SessionEventType.TurnError, { error, turnPhase: "model" }),
  ];
  const failed = reducer.reduce(events);
  assert.equal(failed.status, "error");
  assert.deepEqual(failed.lastError, error);
  const accepted = event(SessionEventType.TurnStarted, { input: "retry", turnNumber: 2 }, "turn-2");
  const live = reducer.apply(failed, accepted);
  const replayed = reducer.reduce([...events, accepted]);
  assert.equal(live.status, "running");
  assert.equal(live.currentTurnId, "turn-2");
  assert.equal(live.lastError, undefined);
  assert.deepEqual(replayed, live);
});

test("sidecar model usage does not overwrite the main conversation context", () => {
  const reducer = new EventReducer();
  const initial = reducer.reduce([
    event(SessionEventType.SessionCreated, { mode: "default", contextWindow: 1_000_000 }),
  ]);
  const modelComplete = (querySource, inputTokens, outputTokens, stopReason = "stop") =>
    event(SessionEventType.ModelComplete, {
      querySource,
      content: "reply",
      stopReason,
      usage: { inputTokens, outputTokens },
    });
  const main = reducer.apply(initial, modelComplete("main_turn", 1000, 50));
  assert.equal(main.contextUsed, 1050);
  for (const source of ["session_title", "memory_extraction", "compact_summary", "subagent"]) {
    assert.equal(reducer.apply(main, modelComplete(source, 80, 9)).contextUsed, 1050);
  }
  assert.equal(
    reducer.apply(main, modelComplete(undefined, 20, 5, "tool_internal")).contextUsed,
    1050,
  );
  assert.equal(reducer.apply(main, modelComplete(undefined, 2000, 100)).contextUsed, 2100);
});

test("cold compaction recovery prefers durable tail boundaries and preserves distinct operations", () => {
  const transient = { id: "transient", type: "compaction", operationId: "skip" };
  const pending = {
    id: "pending",
    type: "compaction",
    operationId: "op-1",
    timelineStatus: "running",
  };
  const durable = {
    id: "durable",
    type: "compaction",
    operationId: "op-1",
    tail_start_id: "message-tail",
  };
  const laterPending = { ...pending, id: "later-pending" };
  const legacy = { id: "legacy", type: "compaction", compactBoundary: { kind: "legacy" } };
  const result = indexDurableCompactionParts([
    { parts: [transient, pending, durable] },
    { parts: [laterPending, legacy] },
  ]);
  assert.equal(result.size, 2);
  assert.equal(result.get("op-1"), durable);
  assert.equal(result.get("legacy-compact-legacy"), legacy);
  assert.equal(result.has("skip"), false);
});

test("request admission queue events do not enter the provider status schema", () => {
  const normalizer = new ConversationTelemetryFactNormalizer();
  for (const type of ["model_request_queued", "model_request_admitted"]) {
    const queued = event(SessionEventType.ModelNetworkStatus, {
      type,
      requestId: "request-1",
      providerId: "deepseek",
      modelId: "deepseek-flash",
      transport: "http",
      attempt: 1,
      maxAttempts: 3,
      querySource: "main_turn",
    });
    assert.equal(normalizer.normalize("session-regression", queued), null);
  }
});

test("permission and child telemetry retain the admitted input until turn cleanup", () => {
  const normalizer = new ConversationTelemetryFactNormalizer();
  normalizer.normalize(
    "session-regression",
    event(SessionEventType.TurnStarted, { inputId: "input-1" }),
  );
  const requested = event(SessionEventType.PermissionRequested, {
    toolCallId: "tool-1",
    toolName: "Bash",
    requestId: "permission-1",
  });
  const permission = normalizer.normalize("session-regression", requested);
  assert.equal(permission.phase, "requested");
  assert.equal(permission.sourceCommandId, "input-1");
  const child = normalizer.normalize(
    "session-regression",
    event(SessionEventType.SubagentStopped, {
      agentId: "agent-1",
      childSessionId: "child-1",
      background: true,
      error: "provider failed",
    }),
  );
  assert.equal(child.kind, "subagent.lifecycle");
  assert.equal(child.sourceCommandId, "input-1");
  assert.equal(child.errorMessage, "provider failed");
  normalizer.normalize(
    "session-regression",
    event(SessionEventType.TurnComplete, {
      resultType: "success",
      response: "done",
      duration: 100,
      tokenCount: 10,
      toolCallCount: 0,
    }),
  );
  assert.equal(normalizer.normalize("session-regression", requested).sourceCommandId, undefined);
});

test("compaction telemetry uses the observed model and clears it with its session", () => {
  const normalizer = new ConversationTelemetryFactNormalizer();
  const metadata = { modelName: "fallback-model", modelProvider: "fallback-provider" };
  normalizer.normalize(
    "session-regression",
    event(SessionEventType.ModelNetworkStatus, {
      type: "model_request_started",
      requestId: "request-1",
      providerId: "deepseek",
      modelId: "deepseek-flash",
      transport: "http",
      attempt: 1,
      maxAttempts: 3,
      querySource: "main_turn",
    }),
  );
  const completed = event(SessionEventType.CompactCompleted, {
    operationId: "compact-1",
    status: "completed",
    trigger: "manual",
  });
  const observed = normalizer.normalize("session-regression", completed, metadata);
  assert.equal(observed.kind, "compaction.terminal");
  assert.equal(observed.modelName, "deepseek-flash");
  assert.equal(observed.modelProvider, "deepseek");
  normalizer.clearSession("session-regression");
  const fallback = normalizer.normalize("session-regression", completed, metadata);
  assert.equal(fallback.modelName, metadata.modelName);
  assert.equal(fallback.modelProvider, metadata.modelProvider);
});
