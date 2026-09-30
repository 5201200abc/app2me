import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProductProjection } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/product-projection.ts";
import { SessionEventType as E } from "../apps/mycode-cli/packages/contracts/src/events/session.events.ts";
let Baseline;
const root = fileURLToPath(new URL("../", import.meta.url));
before(async () => {
  const relative =
    "apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/product-projection.ts";
  const original = resolve(root, relative),
    require = createRequire(pathToFileURL(original));
  let body = await readFile(
    resolve(root, ".artifacts/mycode-followup/refactor-backups", relative),
    "utf8",
  );
  const matches = [...body.matchAll(/from "([^"]+)"/g)];
  for (const specifier of new Set(matches.map((m) => m[1]))) {
    let target;
    if (specifier.startsWith(".")) {
      target = resolve(dirname(original), specifier);
      const source = target.replace(/\.js$/, ".ts");
      try {
        await access(source);
        target = source;
      } catch {}
    } else if (specifier === "@mycode/contracts") {
      const packageDir = resolve(root, "apps/mycode-cli/packages/contracts");
      const manifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
      target = resolve(packageDir, manifest.exports["."].import);
    } else target = require.resolve(specifier);
    body = body.replaceAll(`from "${specifier}"`, `from "${pathToFileURL(target).href}"`);
  }
  const destination = resolve(
    root,
    ".artifacts/mycode-followup/runtime-baseline/product-projection.ts",
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
  Baseline = (await import(pathToFileURL(destination).href)).ProductProjection;
});
const event = (seq, type, payload, turnId = "turn-1") => ({
  id: `e-${seq}`,
  sessionId: "projection-test",
  traceId: "trace-test",
  turnId,
  timestamp: new Date(1000 + seq * 20),
  sequenceNumber: seq,
  type,
  payload,
});
function scenario(turns = 12) {
  const events = [];
  let seq = 0;
  const add = (type, payload, turn) => events.push(event(++seq, type, payload, turn));
  add(E.SessionCreated, {});
  for (let n = 1; n <= turns; n++) {
    const turn = `turn-${n}`,
      assistant = `a-${n}`;
    add(
      E.ModelSelected,
      {
        modelSelection: { providerId: "test", modelId: `m-${n % 2}` },
        contextWindow: 64000,
        supportedThoughtLevels: ["off"],
      },
      turn,
    );
    add(
      E.TurnStarted,
      {
        turnNumber: n,
        input: `Question ${n}`,
        messageId: `u-${n}`,
        inputId: `cmd-${n}`,
        executionKind: "agent",
      },
      turn,
    );
    add(
      E.ModelStreaming,
      {
        kind: "reasoning_delta",
        delta: "checking",
        done: false,
        assistantMessageId: assistant,
        partId: `r-${n}`,
      },
      turn,
    );
    add(
      E.ModelStreaming,
      {
        kind: "reasoning_end",
        delta: "",
        done: true,
        assistantMessageId: assistant,
        partId: `r-${n}`,
      },
      turn,
    );
    add(
      E.ToolCallScheduled,
      {
        toolCallId: `tool-${n}`,
        assistantMessageId: assistant,
        toolName: "Read",
        input: { file_path: "example.txt" },
        schedule: { kind: "foreground" },
      },
      turn,
    );
    add(
      E.ToolCallStarted,
      { toolCallId: `tool-${n}`, toolName: "Read", startedAt: new Date(1000 + seq * 20) },
      turn,
    );
    add(
      E.ToolCallResult,
      { toolCallId: `tool-${n}`, result: { success: true, content: "read result" }, duration: 10 },
      turn,
    );
    add(
      E.ModelStreaming,
      {
        kind: "text_delta",
        delta: `Answer ${n}`,
        done: false,
        assistantMessageId: assistant,
        partId: `text-${n}`,
      },
      turn,
    );
    add(
      E.ModelStreaming,
      {
        kind: "text_delta",
        delta: " complete",
        done: false,
        assistantMessageId: assistant,
        partId: `text-${n}`,
      },
      turn,
    );
    add(
      E.ModelStreaming,
      {
        kind: "text_end",
        delta: "",
        done: true,
        assistantMessageId: assistant,
        partId: `text-${n}`,
      },
      turn,
    );
    add(
      E.TurnComplete,
      {
        response: `Answer ${n} complete`,
        tokenCount: 30,
        toolCallCount: 1,
        duration: 200,
        resultType: "success",
      },
      turn,
    );
  }
  return events;
}
function compare(actual, expected, label) {
  assert.deepEqual(actual.getSnapshot(), expected.getSnapshot(), label);
  assert.equal(
    actual.getDroppedContentStreamEventCount(),
    expected.getDroppedContentStreamEventCount(),
  );
  assert.deepEqual(actual.getNormalizationDiagnostics(), expected.getNormalizationDiagnostics());
  for (const row of actual.getSnapshot().rows.window.slice(-8)) {
    for (const method of [
      "getMessageIdForRow",
      "getEntityIdForRow",
      "resolveEditTarget",
      "getMessageIdsForTurnRow",
      "isLatestAssistantSegmentRow",
      "resolveStableForkCandidate",
      "isLatestRetryAssistantRow",
      "isLatestEditableUserRow",
      "getTurnIdForRow",
      "getTurnRewindAnchor",
    ])
      assert.deepEqual(
        actual[method](row.rowId),
        expected[method](row.rowId),
        `${label} ${method}`,
      );
    const target = { rowId: row.rowId, entityId: row.entityId };
    for (const action of ["editUserQuery", "retryTurn", "forkAssistant"])
      assert.deepEqual(
        actual.resolveRowActionTarget(target, action),
        expected.resolveRowActionTarget(target, action),
        `${label} ${action}`,
      );
  }
}
test("live event replay and row action lookups match the pre-split projection", () => {
  const actual = new ProductProjection("projection-test", "epoch"),
    expected = new Baseline("projection-test", "epoch");
  for (const e of scenario(30)) {
    assert.deepEqual(actual.establishedStreamingAppend(e), expected.establishedStreamingAppend(e));
    assert.deepEqual(
      actual.applyEvent(structuredClone(e)),
      expected.applyEvent(structuredClone(e)),
    );
    compare(actual, expected, `event ${e.sequenceNumber} ${e.type}`);
  }
  assert.ok(actual.getSnapshot().rows.window.some((row) => row.kind === "assistantText"));
  assert.ok(actual.getSnapshot().rows.window.some((row) => row.kind === "toolCall"));
});
test("rejected atomic candidates leave every observable state and later acceptance unchanged", () => {
  const actual = new ProductProjection("projection-test", "epoch"),
    expected = new Baseline("projection-test", "epoch");
  for (const e of scenario(8)) {
    const prior = actual.getSnapshot(),
      copy = structuredClone(prior);
    assert.equal(
      actual.applyEventAtomically(structuredClone(e), () => false),
      null,
    );
    assert.equal(
      expected.applyEventAtomically(structuredClone(e), () => false),
      null,
    );
    assert.equal(actual.getSnapshot(), prior);
    assert.deepEqual(prior, copy);
    compare(actual, expected, `reject ${e.sequenceNumber}`);
    assert.deepEqual(
      actual.applyEventAtomically(structuredClone(e), () => true),
      expected.applyEventAtomically(structuredClone(e), () => true),
    );
    compare(actual, expected, `accept ${e.sequenceNumber}`);
  }
});
test("mutable hydration replay and its final row-action materialization match the baseline", () => {
  const actual = new ProductProjection("projection-test", "epoch"),
    expected = new Baseline("projection-test", "epoch");
  actual.beginHydrationReplay();
  expected.beginHydrationReplay();
  for (const e of scenario(20))
    assert.deepEqual(
      actual.applyHydrationEvent(structuredClone(e)),
      expected.applyHydrationEvent(structuredClone(e)),
    );
  assert.deepEqual(actual.completeHydrationReplay(), expected.completeHydrationReplay());
  compare(actual, expected, "hydration complete");
});
test("authoritative model events keep precedence over later seeds", () => {
  const actual = new ProductProjection("projection-test", "epoch"),
    expected = new Baseline("projection-test", "epoch");
  const seed = {
    modelSelection: { providerId: "seed-provider", modelId: "seed-model" },
    thought: "off",
    mode: "agent",
    thoughtLevels: ["off"],
  };
  for (const p of [actual, expected]) {
    p.seedConfig(seed);
    p.applyEvent(
      event(1, E.ModelSelected, {
        modelSelection: { providerId: "event-provider", modelId: "event-model" },
        contextWindow: 64000,
      }),
    );
    p.seedConfig(seed);
    p.seedSubagents({ revision: 1, childSessionIds: [], running: [] });
  }
  compare(actual, expected, "seed precedence");
  assert.equal(actual.getSnapshot().config.model, "event-model");
});
test("public method names and method enumerability stay unchanged", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(ProductProjection.prototype).sort(),
    Object.getOwnPropertyNames(Baseline.prototype)
      .filter((name) => !name.startsWith("on") && Object.hasOwn(ProductProjection.prototype, name))
      .sort(),
  );
  for (const name of Object.getOwnPropertyNames(ProductProjection.prototype))
    assert.equal(
      Object.getOwnPropertyDescriptor(ProductProjection.prototype, name).enumerable,
      false,
    );
});
