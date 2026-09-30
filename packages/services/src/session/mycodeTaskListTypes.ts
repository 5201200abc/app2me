import type { WorkspacePurpose, MyCodeTaskMeta } from "@mycode/shared";

export type MyCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type MyCodeTaskListSortBy = "created" | "updated";

export interface MyCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface MyCodeTaskListQuery {
  kind: MyCodeTaskListKind;
  workspaceScopes: MyCodeTaskListWorkspaceScope[];
  sortBy: MyCodeTaskListSortBy;
  search?: string;
  limit?: number;
}

export type MyCodeTaskListItem = MyCodeTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface MyCodeTaskListResult {
  items: MyCodeTaskListItem[];
  total: number;
  hasMore: boolean;
}

export type MyCodeTaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface MyCodeTaskGroup {
  id: string;
  title: string;
  color: MyCodeTaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface MyCodeGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type MyCodeGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: MyCodeGroupedTaskRef };

export type MyCodeGroupedTaskViewNode =
  | {
      type: "group";
      group: MyCodeTaskGroup;
      tasks: MyCodeTaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: MyCodeTaskListItem;
      sortOrder?: number;
    };

export interface MyCodeGroupedTaskView {
  nodes: MyCodeGroupedTaskViewNode[];
}

export interface MyCodeGroupedTaskViewQuery {
  workspaceScopes: MyCodeTaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface MyCodeGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type MyCodeGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface MyCodeGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: MyCodeTaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: MyCodeGroupedTaskViewStructureMember[];
  topLevelOrders: MyCodeGroupedTaskViewStructureTopOrder[];
}

export interface MyCodeGroupedTaskViewOrderInput {
  workspaceScopes: MyCodeTaskListWorkspaceScope[];
  topLevelNodes: MyCodeGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: MyCodeGroupedTaskRef[];
  }>;
}

export interface MyCodeWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
