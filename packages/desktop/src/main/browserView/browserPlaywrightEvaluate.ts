import { randomUUID } from "node:crypto";
import type { ControlledView } from "./browserCommandTypes.js";

type EvaluationResult = {
  result?: { value?: unknown; objectId?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

function checkEvaluation(result: EvaluationResult): void {
  if (result.exceptionDetails) {
    throw new Error(
      `playwright.evaluate failed: ${
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Playwright evaluate failed"
      }`,
    );
  }
}

export async function evaluateWithCdp(
  view: ControlledView,
  expression: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const objectGroup = `mycode-evaluate-${randomUUID()}`;
  let objectId: string | undefined;
  let interruption: Error | undefined;
  let cancellation: Promise<unknown> | undefined;
  const cancelRemote = () => {
    if (!objectId || !interruption || cancellation) return;
    cancellation = view.cdp
      .send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function(reason) { this.cancel(reason); }",
        arguments: [{ value: interruption.message }],
        returnByValue: true,
      })
      .catch(() => undefined);
  };
  const interrupt = (error: Error) => {
    interruption ??= error;
    cancelRemote();
  };
  const abort = () => interrupt(new DOMException("aborted", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error(`playwright.evaluate timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    interrupt(error);
  }, timeoutMs);

  try {
    // CDP 的 timeout 不会结束未兑现的 Promise；独立句柄让超时和取消只结束本次等待。
    const holder = (await view.cdp.send("Runtime.evaluate", {
      expression: `(() => {
        let rejectWait;
        const cancelled = new Promise((_, reject) => { rejectWait = reject; });
        const promise = Promise.race([
          Promise.resolve().then(() => (${expression})),
          cancelled,
        ]);
        promise.catch(() => {});
        return { promise, cancel: (reason) => rejectWait(new Error(reason)) };
      })()`,
      objectGroup,
      awaitPromise: false,
      returnByValue: false,
      timeout: timeoutMs,
    })) as EvaluationResult;
    checkEvaluation(holder);
    objectId = holder.result?.objectId;
    if (!objectId) throw new Error("playwright.evaluate did not return a remote handle");
    cancelRemote();
    const result = (await view.cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function() { return this.promise; }",
      awaitPromise: true,
      returnByValue: true,
    })) as EvaluationResult;
    if (interruption) throw interruption;
    checkEvaluation(result);
    return result.result?.value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await cancellation;
    // 等待已结束后再释放整组句柄，避免遗留 CDP pending 阻止 guest debugger 回收。
    await view.cdp.send("Runtime.releaseObjectGroup", { objectGroup }).catch(() => undefined);
  }
}
