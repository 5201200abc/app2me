import assert from "node:assert/strict";
import { test } from "node:test";
import { runStreamText } from "../apps/mycode-cli/packages/adapters/src/model/runner-stream.ts";
import {
  ModelProtocolError,
  ModelErrorCode,
} from "../apps/mycode-cli/packages/contracts/dist/index.js";

const unavailable = () => Object.assign(new Error("Service unavailable"), { statusCode: 503 });
const finish = {
  type: "finish",
  finishReason: "stop",
  totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};
const success = [
  { type: "start" },
  { type: "text-start", id: "text-1" },
  { type: "text-delta", id: "text-1", text: "STREAM_OK" },
  { type: "text-end", id: "text-1" },
  finish,
];
function fixture(attempts) {
  const events = [],
    calls = [],
    cleanups = [],
    order = [];
  let acquired = 0,
    released = 0;
  const resolved = {
    providerId: "fixture",
    modelId: "fixture",
    providerKind: "openai-compatible",
    model: {},
    properties: {},
  };
  const input = {
    env: {},
    resolved,
    resolveModel: () => resolved,
    request: {
      messages: [{ role: "user", content: "Test stream" }],
      modelRequestAdmission: {
        acquire: async () => {
          const id = ++acquired;
          order.push(`acquire:${id}`);
          return {
            publish() {},
            release() {
              released++;
              order.push(`release:${id}`);
            },
          };
        },
      },
    },
    retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 1, jitter: false },
    streamIdleTimeoutMs: 1000,
    modelIoFullRetentionEnabled: false,
    statusSink: { publish: (event) => events.push(event) },
    runtime: {
      streamText: (options) => {
        const index = calls.length;
        calls.push(options);
        order.push(`request:${index + 1}`);
        const next = attempts[index];
        if (next instanceof Error) throw next;
        assert.ok(next, "Unexpected additional model request");
        let position = 0;
        const iterator = {
          async next() {
            const item = next[position++];
            if (item instanceof Error) throw item;
            return item === undefined ? { done: true } : { done: false, value: item };
          },
          async return() {
            cleanups.push(`iterator:${index}`);
            return { done: true };
          },
        };
        return {
          fullStream: { [Symbol.asyncIterator]: () => iterator },
          response: Promise.resolve({ headers: {} }),
          consumeStream: async () => {
            cleanups.push(`consume:${index}`);
          },
        };
      },
    },
  };
  return {
    input,
    events,
    calls,
    cleanups,
    order,
    acquired: () => acquired,
    released: () => released,
  };
}
async function collect(input) {
  const events = [];
  for await (const event of runStreamText(input)) events.push(event);
  return events;
}

test("successful streaming completes and releases its single admission ticket", async () => {
  const f = fixture([success]);
  const events = await collect(f.input);
  assert.equal(
    events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text)
      .join(""),
    "STREAM_OK",
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.released(), 1);
  assert.equal(f.events.filter((event) => event.type === "model_request_completed").length, 1);
  assert.deepEqual(f.cleanups, []);
});

test("setup retry returns admission before acquiring the next request", async () => {
  const f = fixture([unavailable(), success]);
  await collect(f.input);
  assert.deepEqual(f.order, [
    "acquire:1",
    "request:1",
    "release:1",
    "acquire:2",
    "request:2",
    "release:2",
  ]);
  assert.equal(f.events.filter((event) => event.type === "model_retry_scheduled").length, 1);
  assert.equal(f.calls[0].abortSignal.aborted, true);
});

test("retry before visible output cleans both stream branches before another request", async () => {
  const f = fixture([[{ type: "start" }, unavailable()], success]);
  const events = await collect(f.input);
  assert.equal(events.filter((event) => event.type === "start").length, 1);
  assert.deepEqual(f.cleanups, ["iterator:0", "consume:0"]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.released(), 2);
});

test("failure after visible output never replays the model request", async () => {
  const f = fixture([[...success.slice(0, 3), unavailable()]]);
  const visible = [];
  await assert.rejects(async () => {
    for await (const event of runStreamText(f.input)) visible.push(event);
  });
  assert.ok(visible.some((event) => event.type === "text_delta"));
  assert.equal(f.calls.length, 1);
  assert.equal(f.released(), 1);
  assert.equal(f.events.filter((event) => event.type === "model_retry_scheduled").length, 0);
  assert.deepEqual(f.cleanups, ["iterator:0", "consume:0"]);
});

test("consumer early return cancels compact streaming and releases admission", async () => {
  const f = fixture([success]);
  f.input.request.preserveProviderStreamBoundaries = true;
  const stream = runStreamText(f.input);
  while (true) {
    const next = await stream.next();
    assert.equal(next.done, false);
    if (next.value.type === "text_delta") break;
  }
  await stream.return();
  await Promise.resolve();
  assert.equal(f.calls[0].abortSignal.aborted, true);
  assert.equal(f.released(), 1);
  assert.ok(
    f.events.some(
      (event) =>
        event.type === "model_request_failed" && event.errorCode === "model_request_cancelled",
    ),
  );
  assert.equal(f.calls.length, 1);
});

test("missing auth keeps its typed error identity and closes the admitted attempt", async () => {
  const f = fixture([success]);
  const error = new ModelProtocolError(ModelErrorCode.ModelRequestAuthMissing, "Missing test auth");
  f.input.resolveModel = () => {
    throw error;
  };
  await assert.rejects(collect(f.input), (actual) => actual === error);
  assert.equal(f.calls.length, 0);
  assert.equal(f.released(), 1);
});

test("admission rejection never opens a stream or releases an unowned ticket", async () => {
  const f = fixture([success]);
  f.input.request.modelRequestAdmission.acquire = async () => {
    throw new DOMException("Cancelled", "AbortError");
  };
  await assert.rejects(collect(f.input));
  assert.equal(f.calls.length, 0);
  assert.equal(f.released(), 0);
  assert.equal(f.events.at(-1).errorPhase, "connect");
});

test("abnormal zero-usage completion retries once and publishes only the successful finish", async () => {
  const f = fixture([
    [
      { type: "start" },
      {
        ...finish,
        finishReason: "unknown",
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    ],
    success,
  ]);
  const events = await collect(f.input);
  assert.equal(f.calls.length, 2);
  assert.equal(events.filter((event) => event.type === "finish").length, 1);
  assert.equal(f.released(), 2);
  assert.ok(events.some((event) => event.type === "text_delta" && event.text === "STREAM_OK"));
});

test("a normal stop with usage is not treated as a transient empty response", async () => {
  const f = fixture([
    [
      { type: "start" },
      { ...finish, totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
    ],
  ]);
  const events = await collect(f.input);
  assert.equal(f.calls.length, 1);
  assert.equal(events.filter((event) => event.type === "finish").length, 1);
  assert.equal(f.released(), 1);
});
