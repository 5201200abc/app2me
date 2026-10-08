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

test("DeepSeek main model capacity aligns Contracts with live and replayed V4 without an explicit selection", () => {
  const events = [
    event(SessionEventType.SessionCreated, { mode: "default", contextWindow: 500_000 }, 1),
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "OK",
        stopReason: "stop",
        contextWindow: 1_048_576,
        usage: { inputTokens: 1000, outputTokens: 10 },
      },
      2,
    ),
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "title_generation",
        content: "title",
        stopReason: "stop",
        contextWindow: 32_768,
        usage: { inputTokens: 10, outputTokens: 1 },
      },
      3,
    ),
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "legacy",
        stopReason: "stop",
        usage: { inputTokens: 1200, outputTokens: 10 },
      },
      4,
    ),
  ];
  const reducer = new EventReducer();
  assert.equal(reducer.reduce(events).contextWindow, 1_048_576);
  const live = new ProductProjection("context-test", "epoch");
  for (const item of events) live.applyEvent(item);
  const replay = new ProductProjection("context-test", "epoch");
  replay.beginHydrationReplay();
  for (const item of events) replay.applyHydrationEvent(item);
  replay.completeHydrationReplay();
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 1_048_576);
  assert.deepEqual(
    replay.getSnapshot().usage.contextWindow,
    live.getSnapshot().usage.contextWindow,
  );
  assert.equal(reducer.reduce(events).contextUsed, 1210);
});

test("applied model selection capacity updates Contracts before another model request", () => {
  const events = [
    event(SessionEventType.SessionCreated, { mode: "default", contextWindow: 500_000 }, 1),
    event(
      SessionEventType.ModelSelected,
      {
        modelSelection: { providerId: "local-llama-models", modelId: "Qwen3.8-27B" },
        contextWindow: 262_144,
      },
      2,
    ),
    event(
      SessionEventType.ModelSelected,
      {
        modelSelection: { providerId: "deepseek", modelId: "deepseek-flash" },
        contextWindow: 1_048_576,
      },
      3,
    ),
  ];
  const reducer = new EventReducer();
  assert.equal(reducer.reduce(events.slice(0, 2)).contextWindow, 262_144);
  assert.equal(reducer.reduce(events).contextWindow, 1_048_576);
  const live = new ProductProjection("context-test", "epoch");
  for (const item of events.slice(0, 2)) live.applyEvent(item);
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 262_144);
  live.applyEvent(events[2]);
  const replay = new ProductProjection("context-test", "epoch");
  replay.beginHydrationReplay();
  for (const item of events) replay.applyHydrationEvent(item);
  replay.completeHydrationReplay();
  assert.equal(live.getSnapshot().usage.contextWindow.maxTokens, 1_048_576);
  assert.deepEqual(
    replay.getSnapshot().usage.contextWindow,
    live.getSnapshot().usage.contextWindow,
  );
});

test("late hydration usage cannot replace capacity learned from a zero-usage main completion", () => {
  const projection = new ProductProjection("context-test", "epoch");
  projection.applyEvent(
    event(
      SessionEventType.SessionCreated,
      {
        mode: "default",
        contextWindow: 500_000,
      },
      1,
    ),
  );
  projection.applyEvent(
    event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "OK",
        stopReason: "stop",
        contextWindow: 1_048_576,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      2,
    ),
  );
  projection.seedUsage({
    contextWindow: { usedTokens: 1200, maxTokens: 500_000, autoCompactThresholdTokens: null },
  });
  assert.equal(projection.getSnapshot().usage.contextWindow.maxTokens, 1_048_576);
  assert.equal(projection.getSnapshot().usage.contextWindow.usedTokens, 1200);
});

test("cold usage seed restores cache and breakdown after zero-usage hydration without replacing capacity", () => {
  const cache = {
    inputTokens: 1200,
    cacheReadTokens: 1080,
    cacheWriteTokens: 0,
    hitRate: 0.9,
    hitRateRequestCount: 3,
  };
  const breakdown = [{ source: "messages", chars: 1200 }];
  for (const replay of [false, true]) {
    const projection = new ProductProjection("context-test", "epoch");
    if (replay) projection.beginHydrationReplay();
    const completion = event(
      SessionEventType.ModelComplete,
      {
        querySource: "main_turn",
        content: "",
        stopReason: "end_turn",
        contextWindow: 1_048_576,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      1,
    );
    if (replay) {
      projection.applyHydrationEvent(completion);
      projection.completeHydrationReplay();
    } else projection.applyEvent(completion);
    projection.seedUsage({
      contextWindow: {
        usedTokens: 53064,
        maxTokens: 500_000,
        autoCompactThresholdTokens: null,
        cache,
        breakdown,
      },
    });
    assert.deepEqual(projection.getSnapshot().usage.contextWindow, {
      usedTokens: 53064,
      maxTokens: 1_048_576,
      autoCompactThresholdTokens: null,
      cache,
      breakdown,
    });
    projection.seedUsage({
      contextWindow: {
        usedTokens: 1000,
        maxTokens: 500_000,
        autoCompactThresholdTokens: null,
        cache: {
          inputTokens: 1000,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
          hitRate: 0.1,
          hitRateRequestCount: 1,
        },
        breakdown: [],
      },
    });
    assert.equal(projection.getSnapshot().usage.contextWindow.usedTokens, 53064);
    assert.deepEqual(projection.getSnapshot().usage.contextWindow.cache, cache);
    assert.deepEqual(projection.getSnapshot().usage.contextWindow.breakdown, breakdown);
  }
});

test("usage detail recovery preserves event metadata and explicitly unknown capacity", () => {
  const cache = { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 0, hitRate: 0.8 };
  const breakdown = [{ source: "system_prompt", chars: 100 }];
  for (const capacity of [null, 1_048_576]) {
    const projection = new ProductProjection("context-test", "epoch");
    projection.applyEvent(
      event(
        SessionEventType.ModelSelected,
        {
          modelSelection: { providerId: "deepseek", modelId: "deepseek-flash" },
          contextWindow: capacity,
        },
        1,
      ),
    );
    if (capacity !== null)
      projection.applyEvent(
        event(
          SessionEventType.ModelComplete,
          {
            querySource: "main_turn",
            content: "",
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
            cacheHit: cache,
            contextUsageBreakdown: breakdown,
          },
          2,
        ),
      );
    projection.seedUsage({
      contextWindow: {
        usedTokens: 100,
        maxTokens: 500_000,
        autoCompactThresholdTokens: null,
        cache: { ...cache, hitRate: 0.1 },
        breakdown: [{ source: "messages", chars: 100 }],
      },
    });
    const window = projection.getSnapshot().usage.contextWindow;
    if (capacity === null) assert.equal(window, null);
    else {
      assert.equal(window.maxTokens, capacity);
      assert.deepEqual(window.cache, cache);
      assert.deepEqual(window.breakdown, breakdown);
    }
  }
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
