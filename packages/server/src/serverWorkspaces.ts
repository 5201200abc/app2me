import { basename } from "node:path";
import type { ServerRemoteWorkspaceInfo } from "@mycode/shared";

export function resolveServerWorkspaces(
  workspaces: ServerRemoteWorkspaceInfo[] | undefined,
  configuredPath: string | undefined,
): ServerRemoteWorkspaceInfo[] {
  if (workspaces) return workspaces;
  // server 的进程 cwd 是启动位置，不代表用户添加的项目；只有显式配置才发布为项目。
  const path = configuredPath?.trim();
  return path ? [{ path, label: basename(path) || path }] : [];
}
