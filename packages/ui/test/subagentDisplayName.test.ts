import assert from "node:assert/strict";
import test from "node:test";
import { getSubagentDisplayName } from "../src/lib/subagentDisplayName.js";

test("内置显示名不修改原始身份和模型配置键", () => {
  for (const [name, expected] of [
    ["general-purpose", "Worker"],
    ["Explore", "Searcher"],
  ]) {
    const agent = { name, source: "built-in" as const, scope: "built-in" as const };
    const before = { ...agent };
    assert.equal(getSubagentDisplayName(agent), expected);
    assert.deepEqual(agent, before);
  }
});

test("同名用户和插件子智能体保留自身名称", () => {
  for (const name of ["general-purpose", "Explore", "Worker", "Searcher"]) {
    assert.equal(getSubagentDisplayName({ name, source: "user", scope: "user" }), name);
    assert.equal(getSubagentDisplayName({ name, source: "plugin", scope: "user" }), name);
  }
  assert.equal(
    getSubagentDisplayName({ name: "plugin:Explore", source: "plugin", scope: "user" }),
    "Explore",
  );
});
