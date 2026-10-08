import { $getRoot, $isTextNode } from "lexical";
import { $isPromptMentionNode } from "@/mentions/nodes/PromptMentionNode.js";

/** 只投影消息开头的命令节点，正文中的目标引用保持原有行内展示。 */
export function $getLeadingGoalCommand() {
  const node = $getRoot().getFirstDescendant();
  if (!$isPromptMentionNode(node)) return null;
  const mention = node.getMention();
  return mention.category === "commands" && mention.value.replace(/^\//, "").trim() === "goal"
    ? node
    : null;
}

export function $removeLeadingGoalCommand(key: string): boolean {
  const node = $getLeadingGoalCommand();
  // 投影可能在点击与更新间变化，必须校验原节点 key，不能删除后来的命令。
  if (!node || node.getKey() !== key) return false;
  const following = node.getNextSibling();
  const parent = node.getParent();
  node.remove();
  if ($isTextNode(following) && !$isPromptMentionNode(following)) {
    const text = following.getTextContent().replace(/^[ \t]+/, "");
    if (text) following.setTextContent(text);
    else following.remove();
  }
  parent?.selectStart();
  return true;
}
