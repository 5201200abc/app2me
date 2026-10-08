import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCallRow } from "@mycode/shared/mycode-protocol-v4";
import {
  groupOperationRenderItems,
  describeOperationGroup,
  usesComputerOperationIcon,
} from "../src/v4/compactOperationGroups.js";
import { readRawToolCallFileSummaries } from "../src/ToolCallBlocks/fileSummaries.js";

const tool = (id: number, toolName: string, extra: Partial<ToolCallRow> = {}): ToolCallRow => ({
  kind: "toolCall",
  rowId: id,
  turnId: "turn",
  createdAt: 1,
  createdAtSeq: id,
  toolCallId: `tool-${id}`,
  toolName,
  inputText: "",
  status: "success",
  ...extra,
});
const item = (row: ToolCallRow) => ({ kind: "row" as const, key: String(row.rowId), row });

test("node_repl 和普通读取统一摘要，不展示 node_repl 集成名称", () => {
  for (const name of [
    "js",
    "mcp__node_repl__js",
    "mcp__node_repl__js_reset",
    "mcp__node_repl__js_add_node_module_dir",
  ]) {
    const rows = [tool(1, name), tool(2, "Read")];
    assert.deepEqual(describeOperationGroup(rows, "zh-CN"), {
      icon: "read",
      text: "读取文件",
      running: false,
    });
    assert.deepEqual(describeOperationGroup(rows, "en-US"), {
      icon: "read",
      text: "Read files",
      running: false,
    });
    assert.equal(
      describeOperationGroup([tool(1, name, { status: "running" })], "zh-CN").text,
      "正在读取文件",
    );
  }
  const service = tool(3, "mcp__node_repl__other", {
    display: { kind: "mcp_tool", serverName: "node_repl", toolName: "other" },
  });
  assert.equal(describeOperationGroup([service], "zh-CN").text, "读取文件");
  assert.equal(
    describeOperationGroup([service, tool(4, "Bash")], "en-US").text,
    "Read files, ran commands",
  );
  assert.equal(describeOperationGroup([tool(5, "Read")], "zh-CN").text, "读取文件");
  assert.equal(
    describeOperationGroup(
      [
        tool(6, "mcp__node_repl__js", {
          display: { kind: "node_repl_images", source: "browser_turn_end", images: [] },
        }),
      ],
      "en-US",
    ).icon,
    "image",
  );
});

test("截图各组合按类别汇总，不逐条重复工具名称", () => {
  const examples = [
    [["Skill", "Edit", "Read", "Bash"], "skill", "已加载工具、编辑文件、读取文件、运行命令"],
    [["Edit", "Read", "Bash"], "edit", "已编辑文件、读取文件、运行命令"],
    [["Read", "Bash"], "read", "已读取文件、运行命令"],
    [["Edit", "Bash"], "edit", "已编辑文件、运行命令"],
    [["Bash", "WebSearch"], "command", "已运行命令、搜索网页"],
  ] as const;
  for (const [names, icon, text] of examples) {
    const rows = names.map((name, index) => tool(index, name));
    assert.deepEqual(describeOperationGroup(rows, "zh-CN"), { icon, text, running: false });
  }
  assert.equal(
    describeOperationGroup([tool(1, "Edit", { status: "running" })], "en").text,
    "Editing files",
  );
});

test("电脑控制和 MCP 集成按服务去重，进行中摘要反映当前工具", () => {
  const rows = [
    tool(1, "mcp__cua__check_permissions", {
      display: { kind: "mcp_tool", serverName: "cua_driver", toolName: "check_permissions" },
    }),
    tool(2, "mcp__cua__list_apps", {
      display: { kind: "mcp_tool", serverName: "cua_driver", toolName: "list_apps" },
    }),
    tool(3, "Edit"),
    tool(4, "Read"),
    tool(5, "Bash"),
  ];
  assert.equal(
    describeOperationGroup(rows, "zh-CN").text,
    "已使用计算机操作、编辑文件、读取文件、运行命令",
  );
  assert.equal(describeOperationGroup(rows, "en").icon, "integration");
  assert.equal(
    describeOperationGroup([...rows, tool(6, "Edit", { status: "running" })], "zh-CN").text,
    "正在编辑文件",
  );
});

test("计算机操作摘要按工具身份动态显示，中英文和旧记录一致", () => {
  const identities: Partial<ToolCallRow>[] = [
    { toolName: "mcp__cua_driver__list_apps" },
    { toolName: "mcp__cua__list_apps" },
    { display: { kind: "mcp_tool", serverName: "computer-use:cua_driver", toolName: "list_apps" } },
  ];
  for (const identity of identities) {
    const row = tool(1, "mcp__cua__list_apps", identity);
    assert.equal(describeOperationGroup([row], "zh-CN").text, "已使用计算机操作");
    assert.equal(describeOperationGroup([row], "en-US").text, "Used computer");
    assert.equal(
      describeOperationGroup([{ ...row, status: "running" }], "zh-CN").text,
      "使用计算机操作",
    );
    assert.equal(
      describeOperationGroup([{ ...row, status: "inputStreaming" }], "en-US").text,
      "Using computer",
    );
    assert.equal(
      describeOperationGroup([tool(2, "Skill"), row], "zh-CN").text,
      "已加载工具、使用计算机操作",
    );
  }
  assert.equal(
    describeOperationGroup([tool(3, "mcp__example__read")], "en-US").text,
    "Used example integration",
  );
  assert.equal(
    describeOperationGroup([tool(3, "mcp__example__read", { status: "running" })], "en-US").text,
    "Using an integration",
  );
});

test("归并已准备项保留插入 Thought 与 Agent 配对，图片和轮次隔开", () => {
  const reasoning = {
    kind: "row" as const,
    key: "reason",
    row: {
      kind: "reasoning" as const,
      rowId: 2,
      turnId: "turn",
      createdAt: 1,
      createdAtSeq: 2,
      state: "complete" as const,
      text: "思考",
    },
  };
  const agent = {
    kind: "agentToolCall" as const,
    key: "agent",
    row: tool(4, "Agent"),
    subagentRow: { key: "paired" },
  };
  const rows = [
    item(tool(1, "Read")),
    reasoning,
    item(tool(3, "Bash")),
    agent,
    item(tool(5, "view_image")),
    item(tool(6, "Edit")),
    item(tool(7, "Read", { turnId: "other" })),
  ];
  const groups = groupOperationRenderItems(rows);
  assert.equal(groups.length, 5);
  assert.equal(groups[0]?.kind, "operations");
  assert.equal(groups[0]?.kind === "operations" ? groups[0].items[1] : undefined, reasoning);
  assert.equal(groups[1]?.kind === "item" ? groups[1].item : undefined, agent);
  assert.equal(groups[2]?.kind, "item");
  const grown = groupOperationRenderItems([rows[0]!, rows[1]!, rows[2]!, item(tool(8, "Edit"))]);
  assert.equal(grown[0]?.key, groups[0]?.key);
});

test("新文件 diff 使用创建文案，已有文件追加仍为编辑", () => {
  const diff = (oldStart: number) => ({
    kind: "file_diff",
    filePath: "/fixture/created.ts",
    additions: 64,
    deletions: 0,
    structuredPatch: [{ oldStart, oldLines: 0, newStart: 1, newLines: 64, lines: ["+new"] }],
  });
  const created = readRawToolCallFileSummaries(
    { display: diff(0) },
    { kind: "Write", input: { file_path: "/fixture/created.ts", content: "new" } },
  );
  assert.equal(created[0]?.actionLabel, "Created");
  assert.equal(created[0]?.operationKind, "write");
  assert.deepEqual(created[0]?.changeStat, { added: 64, removed: 0 });
  assert.equal(
    readRawToolCallFileSummaries({ display: diff(10) }, { kind: "Edit" })[0]?.actionLabel,
    "Edited",
  );
});

test("计算机图标按当前操作和历史服务身份选择，其他 MCP 保留原图标", () => {
  for (const serverName of ["cua", "cua_driver", "computer-use:cua_driver"]) {
    const computer = tool(20, "mcp__cua__list_apps", {
      display: { kind: "mcp_tool", serverName, toolName: "list_apps" },
    });
    assert.equal(usesComputerOperationIcon([computer]), true);
    assert.equal(usesComputerOperationIcon([computer, tool(21, "Read")]), true);
    assert.equal(
      usesComputerOperationIcon([computer, tool(21, "Read", { status: "running" })]),
      false,
    );
    assert.equal(usesComputerOperationIcon([{ ...computer, status: "running" }]), true);
    assert.equal(
      usesComputerOperationIcon([computer, tool(22, "mcp__github__issue", { status: "running" })]),
      false,
    );
  }
  assert.equal(usesComputerOperationIcon([tool(1, "mcp__github__issue")]), false);
});
