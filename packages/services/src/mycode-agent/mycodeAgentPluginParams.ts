import type {
  MyCodeAgentMcpServer,
  MyCodeAutomationScheduleRule,
  MyCodeMcpListMode,
  ModelSelection,
} from "@mycode/shared";

export interface MyCodeAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface MyCodeAgentPluginViewParams extends MyCodeAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface MyCodeAgentListMcpServerStatusesParams extends MyCodeAgentWorkspaceTarget {
  mcpServers?: MyCodeAgentMcpServer[];
  mode?: MyCodeMcpListMode;
}

export interface MyCodeAgentAddPluginMarketplaceParams extends MyCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface MyCodeAgentRemovePluginMarketplaceParams extends MyCodeAgentWorkspaceTarget {
  marketplace: string;
}

export interface MyCodeAgentUpdatePluginMarketplaceParams extends MyCodeAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface MyCodeAgentInstallPluginParams extends MyCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface MyCodeAgentCancelPluginOperationParams {
  operationId: string;
}

export interface MyCodeAgentUninstallPluginParams extends MyCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface MyCodeAgentUpdatePluginParams extends MyCodeAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface MyCodeAgentRestoreBuiltinPluginParams extends MyCodeAgentWorkspaceTarget {
  pluginId: string;
}

export interface MyCodeAgentConfigurePluginParams extends MyCodeAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface MyCodeAgentResetPluginConfigParams extends MyCodeAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface MyCodeAgentValidatePluginParams extends MyCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface MyCodeAgentDescribePluginParams extends MyCodeAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface MyCodeAgentSetPluginEnabledParams extends MyCodeAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface MyCodeAgentPluginReferenceCatalogParams extends MyCodeAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface MyCodeAgentSkillReferenceCatalogParams extends MyCodeAgentWorkspaceTarget {
  sessionId?: string;
}
export interface MyCodeAgentResolveSuggestedPluginReferenceParams extends MyCodeAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface MyCodeAgentCreateAutomationParams extends MyCodeAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: MyCodeAutomationScheduleRule;
}

export interface MyCodeAgentUpdateAutomationParams extends MyCodeAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: MyCodeAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface MyCodeAgentAutomationIdParams extends MyCodeAgentWorkspaceTarget {
  automationId: string;
}

export interface MyCodeAgentSetAutomationEnabledParams extends MyCodeAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface MyCodeAgentDeleteAutomationRunParams extends MyCodeAgentWorkspaceTarget {
  runId: string;
}
