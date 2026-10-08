import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";
export function cleanToolDisplayNode(node: ReactNode): ReactNode {
  if (typeof node === "string") return stripDisplayEmoji(node);
  if (Array.isArray(node)) return Children.map(node, cleanToolDisplayNode);
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined)
    return cloneElement(node, {}, cleanToolDisplayNode(node.props.children));
  return node;
}
