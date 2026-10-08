import type { WorkspaceTabState } from "@/store/tabStore.js";

export function isPluginScopeWorkspaceConnected(tab: WorkspaceTabState): boolean {
  if (tab.availability === "unavailable-local-directory") return false;
  const remote = Boolean(tab.workspaceIdentity?.trim() || tab.remoteTarget || tab.remoteSessionId);
  return !remote || Boolean(tab.remoteSessionId);
}

export function isPluginScopeWorkspaceSelectable(tab: WorkspaceTabState): boolean {
  // 无项目会话的 backing 目录曾混入项目作用域；旧 tab 缺 purpose 时只识别系统路径，
  // 不能按 default 文案过滤，否则会误删用户同名项目或远端项目。
  const legacyDefault =
    !tab.workspaceIdentity?.trim() &&
    !tab.remoteTarget &&
    !tab.remoteSessionId &&
    /\/\.mycode\/workspace\/default\/?$/i.test(tab.workspacePath.replace(/\\/g, "/"));
  return (
    isPluginScopeWorkspaceConnected(tab) &&
    tab.workspacePurpose !== "conversation" &&
    !legacyDefault
  );
}
