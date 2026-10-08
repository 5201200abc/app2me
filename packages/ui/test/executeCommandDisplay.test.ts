import assert from "node:assert/strict";
import test from "node:test";
import {
  getExecuteCommandDisplayText,
  getExecuteSecondaryText,
} from "../src/ToolCallBlocks/executeCommandDisplay.js";

test("命令摘要保留完整原文，不以 parsed_cmd 首条替代", () => {
  const command = "  sed -n '40,88p' main.go; printf '%s' '$& $$';\nls -la  ";
  const input = { command, parsed_cmd: [{ cmd: "sed -n '40,88p' main.go" }] };
  assert.equal(getExecuteCommandDisplayText(input), command);
  assert.equal(getExecuteCommandDisplayText(["/bin/zsh", "-lc", command]), command);
  assert.equal(getExecuteCommandDisplayText(command), command);
  assert.equal(getExecuteCommandDisplayText({ script: command }), command);
  assert.equal(getExecuteCommandDisplayText({ cmd: command }), command);
  assert.equal(getExecuteSecondaryText(input), "sed -n '40,88p' main.go");
  assert.deepEqual(input, { command, parsed_cmd: [{ cmd: "sed -n '40,88p' main.go" }] });
});

test("兼容只有解析命令的旧输入，空输入不编造命令", () => {
  assert.equal(getExecuteCommandDisplayText({ parsed_cmd: [{ cmd: "ls -la" }] }), "ls -la");
  assert.equal(getExecuteCommandDisplayText({}), undefined);
  assert.equal(getExecuteCommandDisplayText(null), undefined);
  assert.equal(getExecuteCommandDisplayText("   "), undefined);
});
