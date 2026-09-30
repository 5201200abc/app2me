import type { ProjectId } from "./shared.js";
import type { CollaborationMode } from "./session.port.js";
import {
  type ModelUsageRecord,
  type TurnUsageRecord,
  type ToolUsageRecord,
  type AppUsageQueryInput,
  type AppUsageQueryResult,
  type TaskUsageQueryInput,
  type TaskUsageQueryResult,
} from "./session-store.port-repair-remote-session-paths-input.js";

export interface UsageStorePort {
  recordModelUsage(input: ModelUsageRecord): Promise<void>;
  upsertTurnUsage(input: TurnUsageRecord): Promise<void>;
  upsertToolUsage(input: ToolUsageRecord): Promise<void>;
  pruneUsage(input?: { beforeTime?: number }): Promise<void>;
  queryAppUsage(input: AppUsageQueryInput): Promise<AppUsageQueryResult>;
  queryTaskUsage(input: TaskUsageQueryInput): Promise<TaskUsageQueryResult>;
}

export interface LocalSettingStorePort {
  getProjectPermissionMode(
    projectID: ProjectId,
  ): CollaborationMode | null | Promise<CollaborationMode | null>;
  saveProjectPermissionMode(input: {
    mode: CollaborationMode;
    projectID: ProjectId;
  }): CollaborationMode | Promise<CollaborationMode>;
}
