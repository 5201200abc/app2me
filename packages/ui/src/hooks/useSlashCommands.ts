/**
 * MyCode Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useMyCodeSessionStore, selectWorkspaceMyCodeState } from "../store/mycodeSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useMyCodeSessionStore(
    (state) => selectWorkspaceMyCodeState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
