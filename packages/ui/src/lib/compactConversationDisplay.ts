import type { ConversationRow } from "@mycode/shared/mycode-protocol-v4";

export function stripDisplayEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\u200d|\ufe0f|\ufe0e|\p{Emoji_Modifier}/gu, "");
}

function normalizedThought(text: string): string {
  return stripDisplayEmoji(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function sameThought(left: string, right: string): boolean {
  const a = normalizedThought(left);
  const b = normalizedThought(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 20) return false;
  const pairs = (value: string) => {
    const chars = Array.from(value);
    return new Set(chars.slice(1).map((char, index) => `${chars[index]}${char}`));
  };
  const ap = pairs(a),
    bp = pairs(b);
  const common = [...ap].filter((pair) => bp.has(pair)).length;
  return (2 * common) / (ap.size + bp.size) >= 0.9;
}

export function dedupeConversationThoughts<T extends ConversationRow>(rows: readonly T[]): T[] {
  // 只改展示投影；保留 journal 和工具原序，不能跨轮隐藏推理。
  return rows.filter((row, index) => {
    if (row.kind !== "reasoning") return true;
    const next = rows[index + 1];
    if (!next || next.turnId !== row.turnId) return true;
    if (next.kind === "reasoning") return false;
    return next.kind !== "assistantText" || !sameThought(row.text, next.text);
  });
}

interface DisplayMarkdownNode {
  type: string;
  value?: string;
  children?: DisplayMarkdownNode[];
}
export function remarkStripDisplayEmoji() {
  return (tree: DisplayMarkdownNode) => {
    const walk = (node: DisplayMarkdownNode) => {
      // 只清理文本节点，不改 URL、代码文件内容或执行参数。
      if (node.type === "text" && node.value) node.value = stripDisplayEmoji(node.value);
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
