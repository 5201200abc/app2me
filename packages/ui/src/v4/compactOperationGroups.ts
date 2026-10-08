import type { ToolCallRow } from "@mycode/shared/mycode-protocol-v4";
import type { AssistantWorkRow } from "@/v4/conversationTurnRenderUnits.js";
import { isComputerOperationService } from "@/lib/computerOperationPresentation.js";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";
import { resolveToolCallIdentity } from "@/lib/toolIdentity.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";

export type OperationCategory =
  | "skill"
  | "integration"
  | "edit"
  | "read"
  | "command"
  | "search"
  | "image";

export function operationCategory(row: ToolCallRow): OperationCategory | null {
  const display = row.output?.display ?? row.display;
  if (
    row.toolName === "view_image" ||
    (display?.kind === "node_repl_images" && display.source === "browser_turn_end")
  )
    return "image";
  const family = resolveToolCallIdentity(toolCallRowToLegacyNode(row).toolCall).family;
  // node_repl 的 MCP 包装不代表“使用集成”；读取摘要统一复用 read 类别并去重。
  if (
    family === "node-repl" ||
    (display?.kind === "mcp_tool" && display.serverName === "node_repl")
  )
    return "read";
  if (display?.kind === "mcp_tool" || display?.kind === "cua" || row.toolName.startsWith("mcp__"))
    return "integration";
  switch (family) {
    case "skill":
      return "skill";
    case "file-write":
      return "edit";
    case "file-read":
      return "read";
    case "shell":
      return "command";
    case "search":
      return "search";
    default:
      return null;
  }
}

type RenderItem = { kind: string; key: string; row?: AssistantWorkRow };
export type OperationRenderGroup<T> =
  | { kind: "item"; key: string; item: T }
  | { kind: "operations"; key: string; items: T[]; rows: ToolCallRow[] };

export function groupOperationRenderItems<T extends RenderItem>(
  items: readonly T[],
): OperationRenderGroup<T>[] {
  const result: OperationRenderGroup<T>[] = [];
  let index = 0;
  while (index < items.length) {
    const first = items[index++]!;
    const row = first.kind === "row" ? first.row : undefined;
    if (row?.kind !== "toolCall" || !operationCategory(row) || operationCategory(row) === "image") {
      result.push({ kind: "item", key: first.key, item: first });
      continue;
    }
    const entries = [first];
    const tools = [row];
    while (index < items.length) {
      let next = index;
      // Thought 仅在前后都有工具时并入；不能吞掉正文、Agent 配对和交互审批边界。
      while (
        items[next]?.kind === "row" &&
        items[next]?.row?.kind === "reasoning" &&
        items[next]?.row?.turnId === row.turnId
      )
        next++;
      const candidate = items[next];
      const candidateRow = candidate?.kind === "row" ? candidate.row : undefined;
      if (
        candidateRow?.kind !== "toolCall" ||
        candidateRow.turnId !== row.turnId ||
        !operationCategory(candidateRow) ||
        operationCategory(candidateRow) === "image"
      )
        break;
      entries.push(...items.slice(index, next + 1));
      tools.push(candidateRow);
      index = next + 1;
    }
    result.push({
      kind: "operations",
      key: `operations:${row.toolCallId}`,
      items: entries,
      rows: tools,
    });
  }
  return result;
}

const categoryOrder: OperationCategory[] = [
  "skill",
  "integration",
  "edit",
  "read",
  "command",
  "search",
  "image",
];
const english: Record<OperationCategory, [string, string]> = {
  skill: ["Loaded a tool", "Loading a tool"],
  integration: ["Used an integration", "Using an integration"],
  edit: ["Edited files", "Editing files"],
  read: ["Read files", "Reading files"],
  command: ["Ran commands", "Running a command"],
  search: ["Searched the web", "Searching the web"],
  image: ["Viewed an image", "Viewing an image"],
};
const chinese: Record<OperationCategory, string> = {
  skill: "加载工具",
  integration: "使用集成",
  edit: "编辑文件",
  read: "读取文件",
  command: "运行命令",
  search: "搜索网页",
  image: "查看图片",
};

function integrationService(row: ToolCallRow): string {
  const display = row.output?.display ?? row.display;
  if (display?.kind === "cua") return "cua_driver";
  const name =
    display?.kind === "mcp_tool"
      ? display.serverName
      : (row.toolName.match(/^mcp__(.*?)__/)?.[1] ?? "Computer Use");
  // 旧记录用 cua 编码，插件记录可能带命名空间；仅折叠显示名称，不修改工具身份。
  return isComputerOperationService(name) ? "cua_driver" : stripDisplayEmoji(name);
}

function activeOperation(rows: readonly ToolCallRow[]): ToolCallRow | undefined {
  return rows.findLast(
    (row) =>
      row.status === "running" ||
      row.status === "inputStreaming" ||
      row.status === "pendingApproval",
  );
}

/** 摘要图标沿用同一身份投影，运行态跟随当前操作，完成态识别混合分组中的 CUA。 */
export function usesComputerOperationIcon(rows: readonly ToolCallRow[]): boolean {
  const isComputer = (row: ToolCallRow) =>
    operationCategory(row) === "integration" && integrationService(row) === "cua_driver";
  const active = activeOperation(rows);
  return active ? isComputer(active) : rows.some(isComputer);
}

export function describeOperationGroup(
  rows: readonly ToolCallRow[],
  locale: string,
): { icon: OperationCategory; text: string; running: boolean } {
  const zh = locale.startsWith("zh");
  const active = activeOperation(rows);
  const categories = categoryOrder.filter((category) =>
    rows.some((row) => operationCategory(row) === category),
  );
  const icon = active ? operationCategory(active)! : categories[0]!;
  if (active)
    return {
      icon,
      text:
        icon === "integration" && integrationService(active) === "cua_driver"
          ? zh
            ? "使用计算机操作"
            : "Using computer"
          : zh
            ? `正在${chinese[icon]}`
            : english[icon][1],
      running: true,
    };
  const labels = categories.map((category, index) => {
    if (category === "integration") {
      const services = [
        ...new Set(
          rows.filter((row) => operationCategory(row) === "integration").map(integrationService),
        ),
      ];
      if (services.includes("cua_driver"))
        return services
          .map((service, serviceIndex) =>
            service === "cua_driver"
              ? zh
                ? "使用计算机操作"
                : `${index === 0 && serviceIndex === 0 ? "Used" : "used"} computer`
              : zh
                ? `使用 ${service} 集成`
                : `${index === 0 && serviceIndex === 0 ? "Used" : "used"} ${service} integration`,
          )
          .join(zh ? "、" : ", ");
      return zh
        ? `使用 ${services.join("、")} 集成`
        : `${index === 0 ? "Used" : "used"} ${services.join(", ")} integration`;
    }
    return zh
      ? chinese[category]
      : index === 0
        ? english[category][0]
        : english[category][0].toLowerCase();
  });
  return {
    icon,
    text: zh
      ? categories.length === 1 && icon === "read"
        ? chinese.read
        : `已${labels.join("、")}`
      : labels.join(", "),
    running: false,
  };
}

export type CompactOperationItem =
  | { kind: "row"; row: AssistantWorkRow }
  | { kind: "operations"; key: string; rows: ToolCallRow[] };
export function groupConsecutiveOperations(
  rows: readonly AssistantWorkRow[],
): CompactOperationItem[] {
  const items: CompactOperationItem[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index++]!;
    if (row.kind !== "toolCall") {
      items.push({ kind: "row", row });
      continue;
    }
    const tools = [row];
    while (rows[index]?.kind === "toolCall" && rows[index]?.turnId === row.turnId)
      tools.push(rows[index++] as ToolCallRow);
    if (tools.length === 1) items.push({ kind: "row", row });
    else items.push({ kind: "operations", key: `operations:${row.toolCallId}`, rows: tools });
  }
  return items;
}
export function operationName(row: ToolCallRow): string {
  const name = row.display?.kind === "mcp_tool" ? row.display.toolName : row.toolName;
  const labels: Record<string, string> = {
    check_permissions: "检查权限",
    list_apps: "列出应用",
    click: "点击",
  };
  return stripDisplayEmoji(labels[name] ?? name.replace(/^mcp__.*?__/, ""));
}
