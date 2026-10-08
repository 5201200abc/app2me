import assert from "node:assert/strict";
import { test } from "node:test";
import { readApplicationListSummary } from "../src/ToolCallBlocks/toolResultSummary.js";

test("应用列表摘要来自真实已发布计数，不能写死或猜测", () => {
  assert.deepEqual(
    readApplicationListSummary(
      "✅ Found 94 app(s): 9 running, 85 installed-not-running.\nStructured content: {}",
    ),
    { total: 94, running: 9 },
  );
  assert.deepEqual(
    readApplicationListSummary("Found 3 app(s): 0 running, 3 installed-not-running."),
    { total: 3, running: 0 },
  );
  assert.equal(readApplicationListSummary("Found 3 app(s): 4 running"), null);
  assert.equal(readApplicationListSummary("An application was found"), null);
  assert.equal(readApplicationListSummary(undefined), null);
});
