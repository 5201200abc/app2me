import assert from "node:assert/strict";
import test from "node:test";
import { V4CommandExecutor } from "../apps/mycode-cli/packages/bootstrap/src/mycode-protocol-v4/commands/executor.ts";

function fixture() {
  const records = new Map();
  const mutations = [];
  for (const [id, taskType] of [
    ["existing", "user"],
    ["fork", "user"],
    ["side", "selection_side_chat"],
  ]) {
    let target = null;
    const calls = { continued: 0, queued: [] };
    records.set(id, {
      taskType,
      calls,
      app: {
        sessionId: id,
        getMode: () => "build",
        runtime: {
          getPlanEnabled: () => false,
          getSessionModelSelection: () => ({ providerId: "fixture", modelId: "model" }),
          setExecutionState: async () => {},
        },
        readTarget: async () => target,
        setTarget: async (value) => {
          target = { ...value };
        },
        updateTargetStatus: async (status) => (target ? (target = { ...target, status }) : null),
        continueActiveTarget: async () => {
          calls.continued++;
        },
        enqueueDeferredInput: async (text, options) => {
          calls.queued.push({ text, options });
          return { kind: "queued" };
        },
      },
    });
  }
  return {
    records,
    mutations,
    executor: new V4CommandExecutor({
      getRecord: (id) => records.get(id),
      afterLegacyStateMutation: async (record, reason) =>
        mutations.push([record.app.sessionId, reason]),
    }),
  };
}
const command = (sessionId, type, payload = {}) => ({
  sessionId,
  type,
  payload,
  commandId: `${sessionId}-${type}`,
  clientId: "test",
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("已有、分叉和辅助线程可独立设置、暂停和恢复目标", async () => {
  const { records, executor } = fixture();
  for (const id of records.keys()) {
    await executor.execute(command(id, "sendGoalCommand", { text: `完成 ${id}` }));
    await settle();
    assert.equal((await records.get(id).app.readTarget()).objective, `完成 ${id}`);
    assert.equal(records.get(id).calls.continued, 1);
    await executor.execute(command(id, "pauseGoal"));
    assert.equal((await records.get(id).app.readTarget()).status, "paused");
  }
  await executor.execute(command("side", "resumeGoal"));
  await settle();
  assert.equal((await records.get("side").app.readTarget()).status, "active");
  assert.equal(records.get("side").calls.continued, 2);
  assert.equal((await records.get("existing").app.readTarget()).status, "paused");
  assert.equal((await records.get("fork").app.readTarget()).status, "paused");
});

test("忙碌辅助线程的目标通过同一队列准入，保留命令身份", async () => {
  const { records, executor } = fixture();
  const record = records.get("side");
  record.activeAbortController = new AbortController();
  await executor.execute(command("side", "sendGoalCommand", { text: "后续目标" }));
  assert.equal(await record.app.readTarget(), null);
  assert.equal(record.calls.queued.length, 1);
  assert.equal(record.calls.queued[0].options.commandKind, "sendGoalCommand");
  assert.equal(record.calls.queued[0].options.intent.text, "后续目标");
});

test("辅助线程其余编辑与重试限制继续有效", async () => {
  const { executor } = fixture();
  for (const type of ["editUserQuery", "retryTurn", "forkAssistant", "discardSharedContext"])
    await assert.rejects(
      executor.execute(command("side", type)),
      (error) => error.reasonCode === "guard.selectionSideChatRestrictedCommand",
    );
});
