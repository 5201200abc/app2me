import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareInitialSessionTitle,
  maybeStartSessionTitleGenerationFromExternalInput,
} from "../apps/mycode-cli/packages/core/dist/runtime/methods/session-title.js";

function fixture() {
  const events = [];
  let complete;
  const response = new Promise((resolve) => {
    complete = resolve;
  });
  const session = {
    id: "fixture",
    taskType: "interactive",
    title: "新会话",
    titleSource: "default",
  };
  const selection = { providerId: "fixture", modelId: "model" };
  let requests = 0;
  const model = {
    providerId: "fixture",
    modelId: "model",
    options: {},
    optionSpecs: { reasoningLevel: { values: ["low"] }, maxOutputTokens: { max: 1000 } },
    bind() {
      return this;
    },
    async generateText() {
      requests++;
      return response;
    },
  };
  const runtime = {
    sessionId: "fixture",
    turnNumber: 0,
    sessionTitleGenerationAttempted: false,
    config: { taskType: "interactive", titleGeneration: { enabled: true } },
    logger: { warn() {}, debug() {} },
    rootTraceContext: { traceId: "trace", spanId: "root", sessionId: "fixture" },
    agentTelemetry: {
      captureCausation() {},
      detached() {
        return { run: (fn) => fn(), setResultType() {}, finishCompleted() {}, finishFailed() {} };
      },
    },
    getSessionModelSelection: () => selection,
    modelFactory: () => model,
    extractToolCallsFromResult: () => [],
    createModelStatusSink: () => undefined,
    createEvent: (type, payload) => ({ type, payload, timestamp: new Date() }),
    appendEvent: async (event) => {
      events.push(event);
    },
    trackResidencyBlockingWork: (promise) => promise,
    sessionStore: {
      getSession: async () => ({ ...session }),
      updateSession: async (patch) => {
        if (session.titleSource === "custom") return { ...session };
        Object.assign(session, patch);
        return { ...session };
      },
    },
  };
  return {
    runtime,
    session,
    events,
    requests: () => requests,
    complete: (title) => complete({ text: JSON.stringify({ title }), finishReason: "stop" }),
  };
}

test("短提问先发布简短标题，再允许主模型；同一会话只生成一次", async () => {
  const f = fixture();
  let admitted = false;
  const promise = prepareInitialSessionTitle
    .call(f.runtime, "你是谁", "input-1", f.runtime.rootTraceContext)
    .then(() => {
      admitted = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests(), 1);
  assert.equal(admitted, false);
  f.complete("了解 MyCode 功能");
  await promise;
  assert.equal(f.session.title, "了解 MyCode 功能");
  assert.ok(f.events.some((event) => event.payload.title === f.session.title));
  await prepareInitialSessionTitle.call(
    f.runtime,
    "第二个问题",
    "input-2",
    f.runtime.rootTraceContext,
  );
  assert.equal(f.requests(), 1);
});

test("标题请求期间手动重命名和首输入编辑不会被旧结果覆盖", async () => {
  for (const edit of [false, true]) {
    const f = fixture();
    const promise = prepareInitialSessionTitle.call(
      f.runtime,
      "创建骑车鹈鹕动画",
      "input-1",
      f.runtime.rootTraceContext,
    );
    await new Promise((resolve) => setImmediate(resolve));
    if (edit) f.session.revert = { targetMessageID: "input-1" };
    else {
      f.session.title = "自定义标题";
      f.session.titleSource = "custom";
    }
    f.complete("旧问题的标题");
    await promise;
    assert.notEqual(f.session.title, "旧问题的标题");
  }
});

test("首个 /goal 已启动的标题任务复用一次，超长标题和 emoji 被清理", async () => {
  const f = fixture();
  maybeStartSessionTitleGenerationFromExternalInput.call(f.runtime, "优化界面", {
    traceContext: f.runtime.rootTraceContext,
  });
  let admitted = false;
  const promise = prepareInitialSessionTitle
    .call(f.runtime, "优化界面", "input-1", f.runtime.rootTraceContext)
    .then(() => {
      admitted = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted, false);
  assert.equal(f.requests(), 1);
  f.complete("✅ 创建" + "精致界面".repeat(15));
  await promise;
  assert.ok(Array.from(f.session.title).length <= 28);
  assert.equal(/\p{Extended_Pictographic}/u.test(f.session.title), false);
});
