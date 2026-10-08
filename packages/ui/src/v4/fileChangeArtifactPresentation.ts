import { getPathLeaf } from "@/lib/path.js";
import { stripDisplayEmoji } from "@/lib/compactConversationDisplay.js";

export function formatFileChangeArtifactTitle(files: number, paths: readonly string[]): string {
  const name = files === 1 ? stripDisplayEmoji(getPathLeaf(paths[0] ?? "")) : "";
  return name ? `已编辑 ${name}` : `已编辑 ${files} 个文件`;
}
