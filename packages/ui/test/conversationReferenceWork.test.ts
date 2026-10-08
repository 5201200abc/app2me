import assert from "node:assert/strict";
import { test } from "node:test";
import {
  referenceWorkSegments,
  formatReferenceWorkDuration,
} from "../src/v4/conversationReferenceWork.js";
import type { ConversationTurnRenderUnit } from "../src/v4/conversationTurnRenderUnits.js";

test("参考布局统一工作段的展示折叠，不改变 guide、正文或原始单元", () => {
  const segments = [
    {
      key: "first",
      flowItems: [
        { kind: "userInput", row: { rowId: 1 } },
        { kind: "assistantWork", rows: [{ rowId: 2 }] },
        { kind: "assistantText", row: { rowId: 3 }, latest: false },
      ],
      assistantHistoryDefaultOpen: true,
    },
    {
      key: "guide",
      flowItems: [
        { kind: "userInput", row: { rowId: 4 } },
        { kind: "assistantHistory", rows: [{ rowId: 5 }] },
        { kind: "assistantText", row: { rowId: 6 }, latest: true },
      ],
      assistantHistoryDefaultOpen: true,
    },
  ];
  const unit = {
    key: "turn",
    workSegments: segments,
    workStatus: { state: "completed", durationMs: 682000 },
  } as unknown as ConversationTurnRenderUnit;
  const result = referenceWorkSegments(unit);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.workStatus?.durationMs, 682000);
  assert.equal(result[0]?.flowItems[1]?.kind, "assistantHistory");
  assert.equal(result[1]?.assistantHistoryDefaultOpen, false);
  assert.equal(result[1]?.flowItems[0], segments[1]?.flowItems[0]);
  assert.equal(result[1]?.flowItems[2], segments[1]?.flowItems[2]);
  assert.equal(segments[0]?.flowItems[1]?.kind, "assistantWork");
});

test("全轮耗时放在首个实际工作段，不生成猜测耗时", () => {
  const unit = {
    key: "turn",
    workStatus: { state: "completed", durationMs: 682000 },
    workSegments: [
      { key: "text", flowItems: [{ kind: "assistantText" }] },
      { key: "work", flowItems: [{ kind: "assistantHistory", rows: [] }] },
    ],
  } as unknown as ConversationTurnRenderUnit;
  const result = referenceWorkSegments(unit);
  assert.equal(result[0]?.workStatus, undefined);
  assert.equal(result[1]?.workStatus?.durationMs, 682000);
  assert.equal(formatReferenceWorkDuration(undefined), "");
  assert.equal(formatReferenceWorkDuration(Number.NaN), "");
  assert.equal(formatReferenceWorkDuration(-1), "0m 0s");
  assert.equal(formatReferenceWorkDuration(682999), "11m 22s");
});
