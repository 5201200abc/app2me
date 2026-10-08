import assert from "node:assert/strict";
import { test } from "node:test";
import { getConversationSourceNameResolver } from "../src/v4/conversationSourceNames.js";
import { buildConversationInventory } from "../src/v4/conversationInventoryModel.js";
import type { ConversationRow } from "@mycode/shared/mycode-protocol-v4";
import { formatModelChangeLabel } from "../src/v4/composer/modelTriggerDisplay.js";

const rows: ConversationRow[] = [
  {
    kind: "userInput",
    origin: "realUser",
    rowId: 1,
    turnId: "turn",
    createdAt: 1,
    createdAtSeq: 1,
    text: "截图",
    attachments: [
      { ref: "/tmp/old.png", fileName: "截图1.png", mime: "image/png", bytes: 1 },
      { ref: "artifact:second", fileName: "截图2.png", mime: "image/png", bytes: 1 },
    ],
  },
];
test("截图名为随机 UUID，同一 owner 更新、两个视图和重开均复用，引用不变", () => {
  const owner = {};
  const resolver = getConversationSourceNameResolver(owner);
  const first = buildConversationInventory(rows, "/repo", undefined, resolver);
  const update = buildConversationInventory(
    [...rows],
    "/repo",
    undefined,
    getConversationSourceNameResolver(owner),
  );
  assert.deepEqual(
    first.sources.map((item) => item.label),
    update.sources.map((item) => item.label),
  );
  for (const item of first.sources)
    assert.match(
      item.label,
      /^image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  assert.notEqual(first.sources[0].label, first.sources[1].label);
  assert.equal(first.sources[0].path, "/tmp/old.png");
  assert.equal(first.sources[0].originalName, "截图1.png");
  assert.equal(first.sources[1].path, undefined);
  const other = buildConversationInventory(
    rows,
    "/repo",
    undefined,
    getConversationSourceNameResolver({}),
  );
  assert.notEqual(first.sources[0].label, other.sources[0].label);
});
test("模型切换只显示模型名，不删除模型自身的斜杠", () => {
  assert.equal(formatModelChangeLabel("deepseek-flash"), "deepseek-flash");
  assert.equal(formatModelChangeLabel("Qwen3.8-27B"), "Qwen3.8-27B");
  assert.equal(formatModelChangeLabel("org/custom-model"), "org/custom-model");
});
