import assert from "node:assert/strict";
import test from "node:test";
import {
  readConversationSummaryPanelOverride,
  resolveConversationSummaryPanelVariant,
} from "../src/v4/conversationSummaryPanelState.js";

test("有会话默认展开，手动选择始终优先", () => {
  assert.equal(resolveConversationSummaryPanelVariant(null), "panel");
  assert.equal(resolveConversationSummaryPanelVariant("mini"), "mini");
  assert.equal(resolveConversationSummaryPanelVariant("panel"), "panel");
});

test("工作区身份和会话切换不继承上一会话的手动选择", () => {
  const owner = { scopeKey: JSON.stringify(["remote-a", "session-a"]), variant: "panel" as const };
  assert.equal(readConversationSummaryPanelOverride(owner, owner.scopeKey), "panel");
  for (const scopeKey of [
    JSON.stringify(["remote-b", "session-a"]),
    JSON.stringify(["remote-a", "session-b"]),
  ])
    assert.equal(readConversationSummaryPanelOverride(owner, scopeKey), null);
});
