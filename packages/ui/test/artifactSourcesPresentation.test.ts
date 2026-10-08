import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConversationInventory } from "../src/v4/conversationInventoryModel.js";
import {
  openSourcesSidePane,
  isSidePaneTabVisibleForParent,
} from "../src/lib/workspaceSidePane.js";
import { formatFileChangeArtifactTitle } from "../src/v4/fileChangeArtifactPresentation.js";
import type { ToolCallRow } from "@mycode/shared/mycode-protocol-v4";
import { ConversationProjectionStore } from "../src/v4/conversationProjectionStore.js";
import type { ConversationSnapshot, ConversationRow } from "@mycode/shared/mycode-protocol-v4";
import { buildConversationFlowItems } from "../src/v4/conversationTurnFlowItems.js";

test("产物标题使用真实文件名，多文件只显示文件数量", () => {
  assert.equal(formatFileChangeArtifactTitle(1, ["/repo/src/app.ts"]), "已编辑 app.ts");
  assert.equal(formatFileChangeArtifactTitle(3, ["/repo/src/app.ts"]), "已编辑 3 个文件");
  assert.equal(formatFileChangeArtifactTitle(1, []), "已编辑 1 个文件");
});

test("Sources 保留单轮历史资源，并复用进行中的导航加载", async () => {
  for (const concurrent of [false, true]) {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const older = [
      {
        rowId: 1,
        kind: "userInput",
        origin: "realUser",
        text: "一个问题",
        attachments: [{ ref: "image", fileName: "screen.png", mime: "image/png" }],
      },
    ];
    const store = new ConversationProjectionStore("conversation/fixture", {
      onAssemblyFault: () => () => {},
      onRuntimeRestart: () => () => {},
      rowsRange: async () => {
        calls++;
        if (concurrent) await gate;
        return { atLogEpoch: "epoch", rows: older, hasMore: false };
      },
    } as unknown as ConstructorParameters<typeof ConversationProjectionStore>[1]);
    (store as unknown as { setState: (patch: unknown) => void }).setState({
      snapshot: {
        logEpoch: "epoch",
        rows: {
          firstRowId: 1,
          totalCount: 3,
          window: [
            { rowId: 2, kind: "turnHeader", turnId: "turn" },
            { rowId: 3, kind: "assistantText", turnId: "turn", text: "结果" },
          ],
        },
      } as unknown as ConversationSnapshot,
    });
    if (concurrent) {
      const pending = store.loadAllOlder();
      await store.loadAllOlder({ includeSingleQueryHistory: true });
      release?.();
      assert.equal((await pending).status, "hydrated");
    } else {
      assert.equal((await store.loadAllOlder()).status, "not-enough-queries");
      assert.equal(
        (await store.loadAllOlder({ includeSingleQueryHistory: true })).status,
        "hydrated",
      );
    }
    assert.equal(store.getState().snapshot?.rows.window[0]?.rowId, 1);
    assert.equal(calls, concurrent ? 1 : 2);
    await store.close();
  }
});

test("旧 Todo 日志不能生成任务步骤或空工作分组", () => {
  const row = { kind: "toolCall", toolName: "TodoWrite", rowId: 1 } as ConversationRow;
  assert.deepEqual(
    buildConversationFlowItems({
      orderedRows: [row],
      assistantHistoryRows: [],
      assistantFollowingRows: [],
      assistantTailRows: [],
      timelineOnly: false,
    }),
    [],
  );
});

test("Sources tab 按 workspace identity 和会话复用且不会跨会话显示", () => {
  const request = {
    workspacePath: "/repo",
    workspaceIdentity: "remote:one",
    workspaceKey: "remote:one",
    parentSessionId: "session",
  };
  const first = openSourcesSidePane(null, request);
  const second = openSourcesSidePane(first, request);
  assert.equal(second.tabs.length, 1);
  assert.equal(second.activeTabId, first.activeTabId);
  assert.equal(isSidePaneTabVisibleForParent(second.tabs[0], "session"), true);
  assert.equal(isSidePaneTabVisibleForParent(second.tabs[0], "other"), false);
  assert.equal(
    openSourcesSidePane(second, { ...request, workspaceKey: "remote:two" }).tabs.length,
    2,
  );
});

test("来源提取批量网络搜索、网页和附件，网址去重且不丢真实标题", () => {
  const base = {
    createdAt: 1,
    createdAtSeq: 1,
    turnId: "turn",
    kind: "toolCall" as const,
    status: "success" as const,
    inputText: "",
  };
  const rows: ToolCallRow[] = [
    {
      ...base,
      rowId: 1,
      toolCallId: "search",
      toolName: "web__run",
      input: {
        search_query: [{ q: "SVG animation" }],
        open: [{ ref_id: "https://example.com/guide" }],
      },
    },
    {
      ...base,
      rowId: 2,
      toolCallId: "open",
      toolName: "web__run",
      input: { url: "https://example.com/guide", title: "指南" },
    },
  ];
  const sources = buildConversationInventory(rows, "/repo").sources;
  assert.equal(sources.filter((item) => item.kind === "web").length, 1);
  assert.equal(sources.find((item) => item.kind === "web")?.label, "指南");
  assert.equal(sources.find((item) => item.kind === "search")?.label, "SVG animation");
});
