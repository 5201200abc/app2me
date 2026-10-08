import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDiffCount } from "../src/ToolCallBlocks/renderers.js";

test("已知 diff 始终显示新增与删除，包括零值", () => {
  for (const stat of [
    { added: 453, removed: 0 },
    { added: 0, removed: 3 },
    { added: 0, removed: 0 },
  ]) {
    const html = renderToStaticMarkup(renderDiffCount(stat));
    assert.ok(html.includes(`aria-label="+${stat.added}"`));
    assert.ok(html.includes(`aria-label="-${stat.removed}"`));
  }
});
test("未知 diff 不伪造零统计", () => {
  assert.equal(renderDiffCount(undefined), null);
});
