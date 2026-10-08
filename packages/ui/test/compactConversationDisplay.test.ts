import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stripDisplayEmoji,
  dedupeConversationThoughts,
} from "../src/lib/compactConversationDisplay.js";
import type { ConversationRow } from "@mycode/shared/mycode-protocol-v4";
const row = (
  rowId: number,
  kind: "reasoning" | "assistantText",
  text: string,
): ConversationRow => ({
  rowId,
  kind,
  text,
  turnId: "turn",
  createdAt: 1,
  createdAtSeq: rowId,
  state: "complete",
});
test("显示去 emoji 清理组合符，但不吞掉正常文字", () =>
  assert.equal(stripDisplayEmoji("成功 ✅，失败 ❌，测试 👨‍👩‍👦 👍🏻"), "成功 ，失败 ，测试  "));
test("连续思考仅末条，思考与随后正文重复隐藏，工具和轮次是边界", () => {
  const rows = [
    row(1, "reasoning", "旧思考"),
    row(2, "reasoning", "新的思考。"),
    row(3, "assistantText", "新的思考"),
    row(4, "reasoning", "独立推理"),
    row(5, "assistantText", "不同正文"),
  ];
  assert.deepEqual(
    dedupeConversationThoughts(rows).map((r) => r.rowId),
    [3, 4, 5],
  );
  assert.equal(rows.length, 5);
});

test("连续异类操作按顺序合并，正文和轮次阻断分组，首行身份稳定", async () => {
  const { groupConsecutiveOperations } = await import("../src/v4/compactOperationGroups.js");
  const tool = (rowId: number): ConversationRow => ({
    rowId,
    turnId: "turn",
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `tool${rowId}`,
    toolName: rowId === 1 ? "Read" : "Write",
    status: "success",
    inputText: "",
  });
  const items = groupConsecutiveOperations([
    tool(1),
    tool(2),
    row(3, "assistantText", "边界"),
    tool(4),
  ]);
  assert.equal(items[0]?.kind, "operations");
  assert.equal(items[0]?.kind === "operations" ? items[0].key : "", "operations:tool1");
  assert.equal(items.length, 3);
  assert.equal(groupConsecutiveOperations([tool(1), tool(2), tool(3)])[0]?.kind, "operations");
});
