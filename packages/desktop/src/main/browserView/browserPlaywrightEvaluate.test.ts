import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { handlePlaywrightAction } from "./browserPlaywrightExecutor.js";
import type { ControlledView, ControlledViewCdp } from "./browserCommandTypes.js";

class PageCdp implements ControlledViewCdp {
  readonly calls: string[] = [];
  readonly objects = new Map<string, unknown>();
  readonly groups = new Map<string, string>();
  readonly pageErrors: string[] = [];
  pending = 0;
  private sequence = 0;
  private readonly context = vm.createContext({
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: () => void) =>
      setTimeout(() => {
        try {
          callback();
        } catch (error) {
          this.pageErrors.push(String(error));
        }
      }, 0),
  });

  async send(method: string, raw?: unknown): Promise<unknown> {
    this.calls.push(method);
    const params = raw as Record<string, unknown>;
    if (method === "Runtime.releaseObjectGroup") {
      for (const [id, group] of this.groups) {
        if (group !== params.objectGroup) continue;
        this.objects.delete(id);
        this.groups.delete(id);
      }
      return {};
    }
    if (method === "Runtime.terminateExecution") return {};
    let value: unknown;
    try {
      if (method === "Runtime.evaluate") {
        value = vm.runInContext(String(params.expression), this.context);
      } else if (method === "Runtime.callFunctionOn") {
        const callable = vm.runInContext(`(${params.functionDeclaration})`, this.context);
        const args = (params.arguments as Array<{ value: unknown }> | undefined) ?? [];
        value = callable.apply(
          this.objects.get(String(params.objectId)),
          args.map((arg) => arg.value),
        );
      } else {
        throw new Error(`Unexpected CDP method: ${method}`);
      }
      if (params.awaitPromise) {
        this.pending += 1;
        try {
          value = await value;
        } finally {
          this.pending -= 1;
        }
      }
      if (params.returnByValue) return { result: { value } };
      const objectId = String(++this.sequence);
      this.objects.set(objectId, value);
      this.groups.set(objectId, String(params.objectGroup));
      return { result: { objectId } };
    } catch (error) {
      return { exceptionDetails: { exception: { description: String(error) } } };
    }
  }
}

function evaluate(cdp: PageCdp, expression: string, timeoutMs = 20, signal?: AbortSignal) {
  return handlePlaywrightAction(
    { cdp } as unknown as ControlledView,
    { name: "evaluate", expressionKind: "string", expression, timeoutMs },
    (result) => ({ ...result, elapsedMs: 0 }),
    signal,
  );
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Evaluation did not settle")), 300);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function assertReleased(cdp: PageCdp) {
  assert.equal(cdp.pending, 0, "No pending CDP Promise");
  assert.equal(cdp.objects.size, 0, "No retained remote objects");
}

test("evaluate returns ordinary and asynchronous values and releases handles", async () => {
  const cdp = new PageCdp();
  for (const expression of ["42", "Promise.resolve(42)"]) {
    const result = await bounded(evaluate(cdp, expression));
    assert.equal(result.ok, true);
    assert.equal(result.value, 42);
    assertReleased(cdp);
  }
});

test("evaluate preserves thrown and rejected errors and remains usable", async () => {
  const cdp = new PageCdp();
  for (const expression of [
    '(() => { throw new Error("probe failed"); })()',
    'Promise.reject(new Error("probe failed"))',
  ]) {
    await assert.rejects(bounded(evaluate(cdp, expression)), /probe failed/);
    assertReleased(cdp);
  }
  assert.equal((await bounded(evaluate(cdp, "42"))).value, 42);
});

test("an unresolved Promise uses the evaluate budget and releases pending work", async () => {
  const cdp = new PageCdp();
  await assert.rejects(bounded(evaluate(cdp, "new Promise(() => {})")), { name: "TimeoutError" });
  assertReleased(cdp);
  assert.equal((await bounded(evaluate(cdp, "42"))).value, 42);
});

test("an already aborted evaluation sends no browser commands", async () => {
  const cdp = new PageCdp();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(evaluate(cdp, "42", 20, controller.signal), { name: "AbortError" });
  assert.deepEqual(cdp.calls, []);
});

test("cancelling one evaluation leaves a concurrent evaluation running", async () => {
  const cdp = new PageCdp();
  const controller = new AbortController();
  const cancelled = evaluate(cdp, "new Promise(() => {})", 200, controller.signal);
  const successful = evaluate(
    cdp,
    "new Promise(resolve => setTimeout(() => resolve(42), 20))",
    200,
  );
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(bounded(cancelled), { name: "AbortError" });
  assert.equal((await bounded(successful)).value, 42);
  assert.equal(cdp.calls.includes("Runtime.terminateExecution"), false);
  assertReleased(cdp);
});

test("a throwing frame callback cannot leave its evaluation pending forever", async () => {
  const cdp = new PageCdp();
  const expression =
    "new Promise(() => requestAnimationFrame(() => { const r = {}; r.shing.getCTM(); }))";
  await assert.rejects(bounded(evaluate(cdp, expression)), { name: "TimeoutError" });
  assert.match(cdp.pageErrors[0] ?? "", /getCTM/);
  assertReleased(cdp);
  assert.equal((await bounded(evaluate(cdp, "42"))).value, 42);
});
