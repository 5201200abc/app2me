import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEFAULT_COMPACT_CONTEXT_WINDOW,
  getAutoCompactThreshold,
  shouldAutoCompact,
} from "../apps/mycode-cli/packages/core/src/compact/policy.ts";
import { EventReducer } from "../apps/mycode-cli/packages/contracts/src/events/event-reducer.ts";
import {
  createSessionEvent,
  SessionEventType,
} from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";
import { ProductProjection } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/product-projection.ts";
import { formatModelContextWindowLabel } from "../packages/ui/src/lib/tokenNumberFormat.ts";

const messages = [
  { role: "user", content: "first question" },
  { role: "assistant", content: "first answer" },
  { role: "user", content: "next question" },
];
const event = (type, payload, sequenceNumber) => ({
  ...createSessionEvent(type, "context-test", payload, { turnId: "turn-1" }),
  sequenceNumber,
});

test("bundled, compact and empty session defaults agree on 500K", async () => {
  const release = JSON.parse(
    await readFile(new URL("../config/provider/mycode-builtin.json", import.meta.url), "utf8"),
  );
  assert.equal(DEFAULT_COMPACT_CONTEXT_WINDOW, 500_000);
  assert.equal(
    release.config.modelConfigRules.modelRules[0].config.properties.contextWindow,
    DEFAULT_COMPACT_CONTEXT_WINDOW,
  );
  assert.equal(new EventReducer().reduce([]).contextWindow, 500_000);
  assert.equal(getAutoCompactThreshold(), 466_000);
  assert.equal(formatModelContextWindowLabel(500_000, "zh-CN"), "500K");
});

test("500K compact budget preserves output reserves and triggers exactly at the threshold", () => {
  for (const [maxOutputTokens, threshold] of [
    [8_192, 478_808],
    [16_384, 470_616],
    [32_000, 466_000],
  ]) {
    const config = { contextWindow: 500_000, maxOutputTokens };
    assert.equal(getAutoCompactThreshold(config), threshold);
    for (const tokenCount of [32_768, 200_000, threshold - 1, threshold]) {
      const decision = shouldAutoCompact({
        messages,
        config,
        tokenOverride: { source: "provider_usage", tokenCount },
      });
      assert.equal(decision.shouldCompact, tokenCount >= threshold);
      assert.equal(
        decision.reason,
        tokenCount >= threshold ? "above_threshold" : "below_threshold",
      );
    }
  }
  assert.equal(getAutoCompactThreshold({ contextWindow: 64_000, maxOutputTokens: 8_192 }), 42_808);
  const historical = new EventReducer().reduce([
    event(SessionEventType.SessionCreated, { mode: "default", contextWindow: 64_000 }, 1),
  ]);
  assert.equal(historical.contextWindow, 64_000);
});

test("500K model events reach live and replayed V4 context usage without rewriting history", () => {
  const events = [
    event(SessionEventType.SessionCreated, { mode: "default", contextWindow: 32_768 }, 1),
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "old",
        stopReason: "stop",
        usage: { inputTokens: 1000, outputTokens: 100 },
      },
      2,
    ),
    event(
      SessionEventType.ModelSelected,
      {
        modelSelection: { providerId: "local-llama-models", modelId: "Example" },
        contextWindow: 500_000,
      },
      3,
    ),
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "new",
        stopReason: "stop",
        contextWindow: 500_000,
        usage: { inputTokens: 200_000, outputTokens: 100 },
      },
      4,
    ),
  ];
  const live = new ProductProjection("context-test", "epoch");
  live.applyEvent(events[0]);
  live.applyEvent(events[1]);
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 32_768);
  live.applyEvent(events[2]);
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 500_000);
  live.applyEvent(events[3]);
  const replay = new ProductProjection("context-test", "epoch");
  replay.beginHydrationReplay();
  for (const item of events) replay.applyHydrationEvent(item);
  replay.completeHydrationReplay();
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 500_000);
  assert.equal(live.getSnapshot().usage.contextWindow.usedTokens, 200_100);
  assert.deepEqual(
    replay.getSnapshot().usage.contextWindow,
    live.getSnapshot().usage.contextWindow,
  );
});
