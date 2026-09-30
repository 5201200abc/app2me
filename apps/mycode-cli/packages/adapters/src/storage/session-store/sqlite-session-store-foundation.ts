import { DatabaseSync } from "node:sqlite";
import type {
  CollaborationMode,
  CreateScriptWorkflowActivityInput,
  CreateScriptWorkflowRunInput,
  InputHistoryAttachment,
  InputHistoryEntry,
  InputHistoryKind,
  AppUsageQueryInput,
  AppUsageQueryResult,
  ModelUsageRecord,
  PermissionRuleset,
  ProjectId,
  ScriptWorkflowActivityRecord,
  ScriptWorkflowDefinitionRecord,
  ScriptWorkflowEventRecord,
  ScriptWorkflowRunRecord,
  ScriptWorkflowRunStatus,
  SessionId,
  TaskUsageQueryInput,
  TaskUsageQueryResult,
  ToolUsageRecord,
  TurnUsageRecord,
  UpsertScriptWorkflowDefinitionInput,
  UpdateScriptWorkflowActivityInput,
  UpdateScriptWorkflowRunInput,
} from "@mycode/contracts";

import { SqliteSessionMigrationError } from "./errors.js";
import {
  DEFAULT_SQLITE_STARTUP_LOCK_TIMEOUT_MS,
  runSqliteSessionMigrations,
} from "./migration-runner.js";
import type { ForkCommitFaultStage, SqliteSessionStoreOptions } from "./options.js";
import { ensureParentDir, getDefaultSessionDbPath } from "./paths.js";
import { maybeThrowStorageFsFault } from "../fs-fault-injection.js";

import * as inputHistoryRepository from "./repositories/input-history.js";
import * as localSettingsRepository from "./repositories/local-settings.js";

import * as scriptWorkflowActivityRepository from "./repositories/script-workflow-activities.js";
import * as scriptWorkflowRunRepository from "./repositories/script-workflow-runs.js";

import * as usageRepository from "./repositories/usage.js";
import { deferredStartup } from "./sqlite-session-store-fork-child-session-id.js";
/** One connection owns session and auxiliary persistence for the store instance. */
export abstract class SqliteSessionStoreFoundation {
  protected readonly db: DatabaseSync;

  protected readonly dbPath: string;

  private readonly forkCommitFaultAt?: ForkCommitFaultStage;

  constructor(options: SqliteSessionStoreOptions = {}, startupToken?: symbol) {
    this.dbPath = options.dbPath ?? getDefaultSessionDbPath();
    this.forkCommitFaultAt = options.forkCommitFaultAt;
    const startupLockTimeoutMs =
      options.startupLockTimeoutMs ?? DEFAULT_SQLITE_STARTUP_LOCK_TIMEOUT_MS;
    try {
      ensureParentDir(this.dbPath);
      maybeThrowStorageFsFault({ operation: "sqliteOpen", path: this.dbPath });
      // 多个本地或远程 Agent 会共享同一个 session DB；timeout 必须在执行首条
      // PRAGMA 前生效，否则并发启动会在 migration prelude 直接抛 database is locked。
      this.db = new DatabaseSync(this.dbPath, { timeout: startupLockTimeoutMs });
    } catch (error) {
      throw new SqliteSessionMigrationError(
        `Failed to open SQLite session database at ${this.dbPath}`,
        {
          cause: error,
          dbPath: this.dbPath,
          kind: "open_failed",
        },
      );
    }
    try {
      if (startupToken !== deferredStartup)
        runSqliteSessionMigrations(this.db, this.dbPath, startupLockTimeoutMs);
    } catch (error) {
      try {
        this.db.close();
      } catch {
        /* 保留原始迁移失败。 */
      }
      throw error;
    }
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }

  protected throwBeforeWrite(): void {
    maybeThrowStorageFsFault({ operation: "sqliteRun", path: this.dbPath });
  }

  protected maybeThrowForkCommitFault(stage: ForkCommitFaultStage): void {
    if (this.forkCommitFaultAt === stage) {
      throw new Error(`injected fork commit fault: ${stage}`);
    }
  }

  async recordModelUsage(input: ModelUsageRecord): Promise<void> {
    return usageRepository.recordModelUsage(this.db, input);
  }

  async upsertTurnUsage(input: TurnUsageRecord): Promise<void> {
    return usageRepository.upsertTurnUsage(this.db, input);
  }

  async upsertToolUsage(input: ToolUsageRecord): Promise<void> {
    return usageRepository.upsertToolUsage(this.db, input);
  }

  async pruneUsage(input?: { beforeTime?: number }): Promise<void> {
    return usageRepository.pruneUsage(this.db, input);
  }

  async queryAppUsage(input: AppUsageQueryInput): Promise<AppUsageQueryResult> {
    return usageRepository.queryAppUsage(this.db, input);
  }

  async queryTaskUsage(input: TaskUsageQueryInput): Promise<TaskUsageQueryResult> {
    return usageRepository.queryTaskUsage(this.db, input);
  }

  async recordInputHistory(input: {
    projectID: ProjectId;
    sessionID?: SessionId;
    text: string;
    attachments?: InputHistoryAttachment[];
    kind: InputHistoryKind;
    time?: { created?: number };
  }): Promise<InputHistoryEntry | null> {
    return inputHistoryRepository.recordInputHistory(this.db, input);
  }

  async recallPreviousInputHistory(input: {
    projectID: ProjectId;
    skip?: number;
  }): Promise<InputHistoryEntry | null> {
    return inputHistoryRepository.recallPreviousInputHistory(this.db, input);
  }

  async getProjectPermission(projectID: ProjectId): Promise<PermissionRuleset | null> {
    return localSettingsRepository.getProjectPermission(this.db, projectID);
  }

  async saveProjectPermission(input: {
    projectID: ProjectId;
    permission: PermissionRuleset;
  }): Promise<PermissionRuleset> {
    return localSettingsRepository.saveProjectPermission(this.db, input);
  }

  getProjectPermissionMode(projectID: ProjectId): CollaborationMode | null {
    return localSettingsRepository.getProjectPermissionMode(this.db, projectID);
  }

  saveProjectPermissionMode(input: {
    mode: CollaborationMode;
    projectID: ProjectId;
  }): CollaborationMode {
    return localSettingsRepository.saveProjectPermissionMode(this.db, input);
  }

  async upsertScriptWorkflowDefinition(
    input: UpsertScriptWorkflowDefinitionInput,
  ): Promise<ScriptWorkflowDefinitionRecord> {
    return scriptWorkflowRunRepository.upsertScriptWorkflowDefinition(this.db, input);
  }

  async createScriptWorkflowRun(
    input: CreateScriptWorkflowRunInput,
  ): Promise<ScriptWorkflowRunRecord> {
    return scriptWorkflowRunRepository.createScriptWorkflowRun(this.db, input);
  }

  async updateScriptWorkflowRun(
    input: UpdateScriptWorkflowRunInput,
  ): Promise<ScriptWorkflowRunRecord> {
    return scriptWorkflowRunRepository.updateScriptWorkflowRun(this.db, input);
  }

  async getScriptWorkflowRun(runId: string): Promise<ScriptWorkflowRunRecord | null> {
    return scriptWorkflowRunRepository.getScriptWorkflowRun(this.db, runId);
  }

  async listScriptWorkflowRuns(input?: {
    cwd?: string;
    limit?: number;
    statuses?: readonly ScriptWorkflowRunStatus[];
  }): Promise<ScriptWorkflowRunRecord[]> {
    return scriptWorkflowRunRepository.listScriptWorkflowRuns(this.db, input);
  }

  async createScriptWorkflowActivity(
    input: CreateScriptWorkflowActivityInput,
  ): Promise<ScriptWorkflowActivityRecord> {
    return scriptWorkflowActivityRepository.createScriptWorkflowActivity(this.db, input);
  }

  async updateScriptWorkflowActivity(
    input: UpdateScriptWorkflowActivityInput,
  ): Promise<ScriptWorkflowActivityRecord> {
    return scriptWorkflowActivityRepository.updateScriptWorkflowActivity(this.db, input);
  }

  async findCachedScriptWorkflowActivity(input: {
    callPath: string;
    inputHash: string;
    runId: string;
  }): Promise<ScriptWorkflowActivityRecord | null> {
    return scriptWorkflowActivityRepository.findCachedScriptWorkflowActivity(this.db, input);
  }

  async listScriptWorkflowActivities(input: {
    runId: string;
  }): Promise<ScriptWorkflowActivityRecord[]> {
    return scriptWorkflowActivityRepository.listScriptWorkflowActivities(this.db, input);
  }

  async appendScriptWorkflowEvent(input: {
    activityId?: string;
    id: string;
    payload?: unknown;
    phase?: string;
    runId: string;
    type: string;
  }): Promise<ScriptWorkflowEventRecord> {
    return scriptWorkflowActivityRepository.appendScriptWorkflowEvent(this.db, input);
  }

  async listScriptWorkflowEvents(input: {
    limit?: number;
    runId: string;
  }): Promise<ScriptWorkflowEventRecord[]> {
    return scriptWorkflowActivityRepository.listScriptWorkflowEvents(this.db, input);
  }
}
