import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationRow, ToolCallRow } from "@mycode/shared/mycode-protocol-v4";
import { buildConversationInventory } from "../src/v4/conversationInventoryModel.js";
import { normalizeCodeFontSizePx } from "../src/lib/codePreviewSettings.js";
import { isPluginScopeWorkspaceSelectable } from "../src/lib/pluginScopeWorkspaces.js";
import { normalizeUiFontSizePx } from "../src/lib/uiFontSize.js";

const base = { turnId: "turn", createdAt: 1, createdAtSeq: 1 };
function tool(rowId: number, patch: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    ...base,
    rowId,
    kind: "toolCall",
    toolCallId: `tool-${rowId}`,
    toolName: "Read",
    status: "success",
    inputText: "",
    ...patch,
  };
}

test("清单使用真实产物、去重文件和最新逻辑版本，失败写入不算产物", () => {
  const artifact = {
    ...base,
    kind: "artifact",
    rowId: 8,
    artifactVersionId: "v1",
    logicalArtifactKey: "report",
    displayName: "report.pdf",
    artifactType: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    sha256: "a".repeat(64),
    ref: "ref1",
    state: "current",
  } as const;
  const rows: ConversationRow[] = [
    tool(1, { toolName: "Write", input: { file_path: "src/app.ts" } }),
    tool(2, { toolName: "Edit", input: { file_path: "src/app.ts" } }),
    tool(3, { toolName: "Write", status: "error", input: { file_path: "bad.ts" } }),
    artifact,
    { ...artifact, rowId: 9, artifactVersionId: "v2", ref: "ref2" },
  ];
  const result = buildConversationInventory(rows, "/repo");
  assert.deepEqual(
    result.outputs.map((item) => [item.label, item.rowId]),
    [
      ["app.ts", 2],
      ["report.pdf", 9],
    ],
  );
  assert.equal(result.sources.length, 0);
  assert.equal(buildConversationInventory([], "/other").outputs.length, 0);
});

test("修改按轮次记录，撤销保留状态，截图、搜索和附件均有原始锚点", () => {
  const rows: ConversationRow[] = [
    {
      ...base,
      rowId: 1,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 1,
      fileChanges: { files: 2, additions: 8, deletions: 3, state: "reverted" },
    },
    tool(2, { toolName: "WebSearch", input: { query: "design" } }),
    tool(3, {
      toolName: "Browser",
      display: { kind: "node_repl_images", images: [{ mimeType: "image/png", base64: "x" }] },
    }),
    {
      ...base,
      rowId: 4,
      kind: "userInput",
      text: "附件",
      origin: "realUser",
      attachments: [{ ref: "attachment", fileName: "screen.png", mime: "image/png", bytes: 1 }],
    },
  ];
  const result = buildConversationInventory(rows, "/repo");
  assert.deepEqual(
    result.changes.map(({ rowId, summary }) => [rowId, summary]),
    [[1, rows[0].kind === "turnHeader" ? rows[0].fileChanges : undefined]],
  );
  assert.deepEqual(
    result.sources.map(({ kind, rowId }) => [kind, rowId]),
    [
      ["search", 2],
      ["screenshot", 3],
      ["screenshot", 4],
    ],
  );
});

test("代码字号旧偏好和写入统一限制 11–16，非法值使用默认", () => {
  for (const [input, expected] of [
    [10, 11],
    [20, 16],
    [11.6, 12],
    [16, 16],
    [NaN, 12],
    [Infinity, 12],
  ] as const)
    assert.equal(normalizeCodeFontSizePx(input), expected);
});

test("插件作用域移除默认会话目录，保留真实同名项目、远端身份和连接门禁", () => {
  const tab = {
    id: "id",
    kind: "workspace" as const,
    label: "default",
    workspacePath: "/repo/default",
  };
  assert.equal(
    isPluginScopeWorkspaceSelectable({ ...tab, workspacePurpose: "conversation" }),
    false,
  );
  assert.equal(
    isPluginScopeWorkspaceSelectable({
      ...tab,
      workspacePath: "/home/u/.mycode/workspace/default",
    }),
    false,
  );
  assert.equal(isPluginScopeWorkspaceSelectable(tab), true);
  assert.equal(
    isPluginScopeWorkspaceSelectable({
      ...tab,
      workspaceIdentity: "remote",
      remoteSessionId: "session",
    }),
    true,
  );
  assert.equal(isPluginScopeWorkspaceSelectable({ ...tab, workspaceIdentity: "remote" }), false);
  assert.equal(
    isPluginScopeWorkspaceSelectable({ ...tab, availability: "unavailable-local-directory" }),
    false,
  );
});

test("Sources 不展示 MCP 服务，网址去重，截图保留真实名称与原始引用", () => {
  const rows: ConversationRow[] = [
    tool(1, {
      toolName: "mcp__cua__list_apps",
      display: { kind: "mcp_tool", serverName: "cua", toolName: "list_apps" },
    }),
    tool(2, {
      toolName: "mcp__cua__click",
      display: { kind: "mcp_tool", serverName: "cua", toolName: "click" },
    }),
    tool(3, {
      toolName: "WebFetch",
      input: { url: "https://example.com/page", title: "示例页面" },
    }),
    tool(4, { toolName: "WebFetch", input: { url: "https://example.com/page" } }),
    tool(5, { toolName: "WebSearch", input: { query: "搜索词" } }),
    {
      ...base,
      rowId: 6,
      kind: "userInput",
      text: "",
      origin: "realUser",
      attachments: [{ ref: "ref.png", fileName: "original.png", mime: "image/png", bytes: 1 }],
    },
  ];
  const result = buildConversationInventory(rows, "/repo");
  assert.deepEqual(
    result.sources.map(({ kind, label, count }) => [kind, label, count]),
    [
      ["web", "示例页面", undefined],
      ["search", "搜索词", undefined],
      ["screenshot", result.sources[2]?.label, undefined],
    ],
  );
  assert.match(result.sources[2]!.label, /^image-[0-9a-f-]{36}$/);
  assert.equal(result.sources[2]?.originalName, "original.png");
  assert.equal(result.sources[2]?.ref, "ref.png");
});

test("附件绝对路径保留，远程不透明引用不伪造本机路径", () => {
  const refs = ["/tmp/codex-clipboard-a.png", "C:\\Temp\\image-b.png", "artifact:remote-image"];
  const result = buildConversationInventory(
    [
      {
        ...base,
        rowId: 1,
        kind: "userInput",
        origin: "realUser",
        text: "",
        attachments: refs.map((ref) => ({
          ref,
          fileName: "original.png",
          mime: "image/png",
          bytes: 1,
        })),
      },
    ],
    "/repo",
  );
  assert.deepEqual(
    result.sources.map((item) => item.path),
    [refs[0], refs[1], undefined],
  );
  assert.deepEqual(
    result.sources.map((item) => item.ref),
    refs,
  );
});

test("网络次数来自成功调用，批量、重复网址、内部页面引用与重放不漏算或重复", () => {
  const batch = tool(1, {
    toolName: "web__run",
    input: {
      search_query: [{ q: "北京天气" }, { q: "实时降雨" }],
      open: [{ ref_id: "https://example.com/" }, { ref_id: "turn0search0" }],
    },
  });
  const result = buildConversationInventory(
    [
      batch,
      batch,
      tool(2, { toolName: "WebFetch", input: { url: "https://example.com/" } }),
      tool(3, { toolName: "WebSearch", status: "error", input: { query: "失败搜索" } }),
      tool(4, {
        toolName: "WebFetch",
        status: "cancelled",
        input: { url: "https://example.com/" },
      }),
    ],
    "/repo",
  );
  assert.deepEqual(result.webActivity, { searches: 2, pages: 3 });
  assert.equal(result.sources.filter((item) => item.kind === "web").length, 1);
  assert.deepEqual(buildConversationInventory([], "/repo").webActivity, { searches: 0, pages: 0 });
});

test("界面默认字号稍微放大，已保存的小字号和代码字号独立保留", () => {
  assert.equal(normalizeUiFontSizePx(undefined), 15);
  assert.equal(normalizeUiFontSizePx(14), 14);
  assert.equal(normalizeUiFontSizePx(13), 13);
  assert.equal(normalizeUiFontSizePx(11), 11);
  assert.equal(normalizeUiFontSizePx(20), 15);
  assert.equal(normalizeCodeFontSizePx(undefined), 12);
});
