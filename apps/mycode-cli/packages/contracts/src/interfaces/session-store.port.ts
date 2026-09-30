// Session Store Port：为会话输入、消息和投影提供稳定的存储边界。
// ============================================================

import type { MessageId, PartId, ProjectId, SessionId } from "./shared.js";
import type { TodoItem } from "../tools/todo.js";
import type { SessionGoal, GoalStatus } from "../tools/target.js";
import type { PermissionRuleset } from "./permission.port.js";
import {
  type CreateSessionInput,
  type SessionInfo,
  type ForkChildSessionMetadata,
  type SessionRevert,
  type FileDiff,
} from "./session-store.port-session-task-types.js";
import {
  type ForkCommitBundle,
  type UpdateSessionInput,
  type ListSessionsInput,
  type ClaimLegacySessionWorkspaceInput,
  type RepairLegacyRemoteSessionWorkspaceInput,
  type MessagePart,
  type MessageWithParts,
  type SessionEntryInfo,
  type SessionEntryType,
  type SessionInputDelivery,
} from "./session-store.port-fork-commit-bundle.js";
import {
  type SharedContextImportCommitBundle,
  type SharedContextImportTransition,
  type RepairRemoteSessionPathsInput,
  type SessionInputStatus,
  type SessionInputRecord,
} from "./session-store.port-repair-remote-session-paths-input.js";
import { type MessageInfo } from "./session-store.port-assistant-message-info.js";

export interface SessionStorePort {
  createSession(input: CreateSessionInput): Promise<SessionInfo>;
  /** legacy 兼容原语；V4 stable/compact-edit fork 禁止调用，统一走 commitForkBundle。 */
  createForkedSessionWithMetadata?(
    input: CreateSessionInput,
    metadata: ForkChildSessionMetadata,
  ): Promise<SessionInfo>;
  /** V4 stable/compact-edit fork 的唯一事务入口。legacy workspace fork 不调用。 */
  commitForkBundle?(bundle: ForkCommitBundle): Promise<SessionInfo>;
  commitSharedContextImportBundle?(bundle: SharedContextImportCommitBundle): Promise<SessionInfo>;
  transitionSharedContextImport?(input: SharedContextImportTransition): Promise<boolean>;
  updateSession(input: UpdateSessionInput): Promise<SessionInfo>;
  getSession(sessionID: SessionId): Promise<SessionInfo | null>;
  listSessions(input?: ListSessionsInput): Promise<SessionInfo[]>;
  /**
   * 用 host task-index allowlist 为旧远端 session 补写 workspace identity。
   * 实现必须同时校验 id、directory 与 workspace_id is null，禁止覆盖已有 identity。
   */
  claimLegacySessionWorkspace?(input: ClaimLegacySessionWorkspaceInput): Promise<number>;
  /**
   * 修复曾把 remote identity 写入 directory/path 的单条历史 session。
   * 实现必须校验 session id、NULL workspace_id 及旧目录精确匹配，禁止批量路径迁移。
   */
  repairLegacyRemoteSessionWorkspace?(
    input: RepairLegacyRemoteSessionWorkspaceInput,
  ): Promise<boolean>;
  /**
   * 已有 remote identity 的维护性路径自愈 CAS。
   * 实现只能更新 directory、path 和单调 time_updated，禁止写回其它 session 元数据。
   */
  repairRemoteSessionPaths?(input: RepairRemoteSessionPathsInput): Promise<boolean>;
  saveMessage(input: MessageInfo, copyFrom?: { sessionID: SessionId; id: string }): Promise<void>;
  removeMessage(input: { sessionID: SessionId; messageID: MessageId }): Promise<void>;
  savePart(input: MessagePart, copyFrom?: { sessionID: SessionId; id: string }): Promise<void>;
  removePart(input: { sessionID: SessionId; messageID: MessageId; partID: PartId }): Promise<void>;
  messageWithParts(input: {
    sessionID: SessionId;
    messageID: MessageId;
  }): Promise<MessageWithParts | null>;
  messages(input: { sessionID: SessionId }): Promise<MessageWithParts[]>;
  saveSessionEntry?(input: SessionEntryInfo): Promise<void>;
  sessionEntries?(input: {
    sessionID: SessionId;
    type?: SessionEntryType | string;
  }): Promise<SessionEntryInfo[]>;
  // ── session_input 账本（可选方法，旧宿主可不实现）──
  /** admission：输入已被接受（排队/待注入），durable 记账。幂等（同 id 重入更新 payload）。 */
  saveSessionInput?(input: {
    id: string;
    sessionID: SessionId;
    kind: string;
    delivery: SessionInputDelivery;
    payload: { text: string; [key: string]: unknown };
  }): Promise<void>;
  /** 审批完全访问：execution、固定队列权限和幂等 receipt 同一事务；无 schema migration。 */
  commitPermissionFullAccess?(input: {
    sessionID: SessionId;
    queueItemIds: string[];
    execution: SessionEntryInfo;
    receipt: SessionEntryInfo;
    signal?: AbortSignal;
  }): Promise<void>;
  /** queue 编辑/重排的 durable 原子更新；只允许修改 admitted 记录。 */
  updateSessionInputs?(input: {
    sessionID: SessionId;
    updates: Array<{
      delivery?: SessionInputDelivery;
      id: string;
      intent?: import("./session.port.js").TurnInputIntentMetadata;
      text?: string;
      queuePosition?: number;
    }>;
  }): Promise<void>;
  /**
   * promotion（原子性硬要求）：账本置 promoted + user message/parts
   * 持久化在同一事务——杜绝「queue 已消费但 transcript 无 user message」的孤儿窗口。
   */
  promoteSessionInput?(input: {
    id: string;
    sessionID: SessionId;
    message: MessageInfo;
    parts: MessagePart[];
  }): Promise<void>;
  /**
   * 非原子 promotion 标记：message 持久化已在别处完成的路径（background wake 的
   * synthetic notice）只补账本状态。新路径应优先用 promoteSessionInput（原子）。
   */
  markSessionInputPromoted?(input: {
    id: string;
    sessionID: SessionId;
    promotedMessageID: MessageId;
  }): Promise<void>;
  /** 终态收口：cancelled（user_removed 等）/ discarded（session_resumed / user_cleared）。 */
  settleSessionInput?(input: {
    id: string;
    sessionID: SessionId;
    status: "cancelled" | "discarded" | "failed";
    reason?: string;
  }): Promise<void>;
  listSessionInputs?(input: {
    sessionID: SessionId;
    status?: SessionInputStatus;
  }): Promise<SessionInputRecord[]>;
  /** global createSession.firstInput 查重：由 queue_<sourceCommandId> 找回真实 session。 */
  getSessionInputById?(id: string): Promise<SessionInputRecord | null>;
  readTodos(input: { sessionID: SessionId }): Promise<TodoItem[]>;
  updateTodos(input: { sessionID: SessionId; todos: TodoItem[] }): Promise<void>;
  readTarget(input: { sessionID: SessionId }): Promise<SessionGoal | null>;
  setTarget(input: {
    objective: string;
    sessionID: SessionId;
    status?: GoalStatus;
    tokenBudget?: number | null;
  }): Promise<SessionGoal>;
  cloneTargetForFork?(input: {
    source: SessionGoal;
    sessionID: SessionId;
    status?: GoalStatus;
  }): Promise<SessionGoal>;
  createTarget(input: {
    objective: string;
    sessionID: SessionId;
    tokenBudget?: number | null;
  }): Promise<SessionGoal | null>;
  updateTargetStatus(input: {
    sessionID: SessionId;
    status: GoalStatus;
  }): Promise<SessionGoal | null>;
  startTargetRun?(input: {
    sessionID: SessionId;
    targetID: string;
    inputID: string;
    startedAtMs: number;
  }): Promise<SessionGoal | null>;
  heartbeatTargetRun?(input: {
    sessionID: SessionId;
    targetID: string;
    inputID: string;
    seenAtMs: number;
  }): Promise<SessionGoal | null>;
  finishTargetRun?(input: {
    sessionID: SessionId;
    targetID: string;
    inputID: string;
    endedAtMs: number;
    status?: GoalStatus;
    tokensUsedDelta?: number;
  }): Promise<SessionGoal | null>;
  recoverInterruptedTargetRun?(input: { sessionID: SessionId }): Promise<SessionGoal | null>;
  accountTargetUsage(input: {
    sessionID: SessionId;
    targetID: string;
    tokensUsedDelta?: number;
    timeUsedSecondsDelta?: number;
  }): Promise<SessionGoal | null>;
  updateTargetSummaryTitle(input: {
    sessionID: SessionId;
    targetID: string;
    summaryTitle: string;
  }): Promise<SessionGoal | null>;
  clearTarget(input: { sessionID: SessionId }): Promise<boolean>;
  getProjectPermission(projectID: ProjectId): Promise<PermissionRuleset | null>;
  saveProjectPermission(input: {
    projectID: ProjectId;
    permission: PermissionRuleset;
  }): Promise<PermissionRuleset>;
  setRevert(input: {
    sessionID: SessionId;
    revert: SessionRevert;
    summary?: { additions: number; deletions: number; files: number; diffs?: FileDiff[] };
  }): Promise<void>;
  clearRevert(sessionID: SessionId): Promise<void>;
}

export { SESSION_TASK_TYPES } from "./session-store.port-session-task-types.js";
export type { SessionTaskType } from "./session-store.port-session-task-types.js";
export { SESSION_TITLE_SOURCES } from "./session-store.port-session-task-types.js";
export type { SessionTitleSource } from "./session-store.port-session-task-types.js";
export { MESSAGE_VISIBILITIES } from "./session-store.port-session-task-types.js";
export type { MessageVisibility } from "./session-store.port-session-task-types.js";
export { SYNTHETIC_USER_MESSAGE_SOURCES } from "./session-store.port-session-task-types.js";
export type { SyntheticUserMessageSource } from "./session-store.port-session-task-types.js";
export type { MessageSemanticsOrigin } from "./session-store.port-session-task-types.js";
export type { MessageSemanticsKind } from "./session-store.port-session-task-types.js";
export type { MessageSemantics } from "./session-store.port-session-task-types.js";
export { MESSAGE_ANCHOR_ORIGINS } from "./session-store.port-session-task-types.js";
export type { MessageAnchorOrigin } from "./session-store.port-session-task-types.js";
export type { StableForkGoalBoundaryMetadata } from "./session-store.port-session-task-types.js";
export type { MessageProjectionAnchor } from "./session-store.port-session-task-types.js";
export type { SessionInfo } from "./session-store.port-session-task-types.js";
export type { CreateSessionInput } from "./session-store.port-session-task-types.js";
export type { StableForkTargetMetadata } from "./session-store.port-session-task-types.js";
export type { ForkChildSessionMetadata } from "./session-store.port-session-task-types.js";
export type { ForkCommandResult } from "./session-store.port-session-task-types.js";
export type { ForkCommitBundle } from "./session-store.port-fork-commit-bundle.js";
export type { UpdateSessionInput } from "./session-store.port-fork-commit-bundle.js";
export type { FileDiff } from "./session-store.port-session-task-types.js";
export type { SessionRevert } from "./session-store.port-session-task-types.js";
export type { ListSessionsInput } from "./session-store.port-fork-commit-bundle.js";
export type { ClaimLegacySessionWorkspaceInput } from "./session-store.port-fork-commit-bundle.js";
export type { RepairLegacyRemoteSessionWorkspaceInput } from "./session-store.port-fork-commit-bundle.js";
export type { RepairRemoteSessionPathsInput } from "./session-store.port-repair-remote-session-paths-input.js";
export type { OutputFormat } from "./session-store.port-session-task-types.js";
export type { MessageSummary } from "./session-store.port-session-task-types.js";
export type { MessageContextSnapshot } from "./session-store.port-session-task-types.js";
export type { UserMessageInfo } from "./session-store.port-session-task-types.js";
export type { AssistantErrorInfo } from "./session-store.port-session-task-types.js";
export type { TokenUsageInfo } from "./session-store.port-session-task-types.js";
export type { AssistantMessageInfo } from "./session-store.port-assistant-message-info.js";
export type { MessageInfo } from "./session-store.port-assistant-message-info.js";
export type { TextPart } from "./session-store.port-assistant-message-info.js";
export type { ReasoningPart } from "./session-store.port-assistant-message-info.js";
export type { FilePartSource } from "./session-store.port-assistant-message-info.js";
export type { AttachmentStorageMetadata } from "./session-store.port-assistant-message-info.js";
export type { FilePart } from "./session-store.port-assistant-message-info.js";
export type { AgentPart } from "./session-store.port-assistant-message-info.js";
export type { CompactionPart } from "./session-store.port-assistant-message-info.js";
export type { TimelinePartDisplay } from "./session-store.port-assistant-message-info.js";
export type { TimelinePartStatus } from "./session-store.port-assistant-message-info.js";
export type { TimelineModelSelection } from "./session-store.port-assistant-message-info.js";
export type { TimelinePartBase } from "./session-store.port-assistant-message-info.js";
export type { ContextCompactionTimelinePart } from "./session-store.port-assistant-message-info.js";
export type { GoalVerificationTimelinePart } from "./session-store.port-assistant-message-info.js";
export type { SessionForkTimelinePart } from "./session-store.port-assistant-message-info.js";
export type { ModelChangeTimelinePart } from "./session-store.port-assistant-message-info.js";
export type { TimelinePart } from "./session-store.port-assistant-message-info.js";
export type { TimelinePartDraft } from "./session-store.port-repair-remote-session-paths-input.js";
export type { SubtaskPart } from "./session-store.port-fork-commit-bundle.js";
export type { RetryPart } from "./session-store.port-fork-commit-bundle.js";
export type { StepStartPart } from "./session-store.port-fork-commit-bundle.js";
export type { StepFinishPart } from "./session-store.port-fork-commit-bundle.js";
export type { SnapshotPart } from "./session-store.port-fork-commit-bundle.js";
export type { PatchPart } from "./session-store.port-fork-commit-bundle.js";
export type { ToolStatePending } from "./session-store.port-fork-commit-bundle.js";
export type { ToolStateRunning } from "./session-store.port-fork-commit-bundle.js";
export type { ToolStateCompleted } from "./session-store.port-fork-commit-bundle.js";
export type { ToolStateError } from "./session-store.port-fork-commit-bundle.js";
export type { ToolState } from "./session-store.port-fork-commit-bundle.js";
export type { ToolPart } from "./session-store.port-fork-commit-bundle.js";
export type { MessagePart } from "./session-store.port-fork-commit-bundle.js";
export type { MessageWithParts } from "./session-store.port-fork-commit-bundle.js";
export type { SharedContextImportCommitBundle } from "./session-store.port-repair-remote-session-paths-input.js";
export type { SharedContextImportStatus } from "./session-store.port-repair-remote-session-paths-input.js";
export type { SharedContextImportTransition } from "./session-store.port-repair-remote-session-paths-input.js";
export { SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_BASH_SHELL_SELECTION } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_MODEL_SELECTION } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_EXECUTION_STATE } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_USER_INPUT_AUTO_RESOLUTION } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_WORKSPACE_CHECKPOINT } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_WORKSPACE_FILE_REWIND } from "./session-store.port-fork-commit-bundle.js";
export { SESSION_ENTRY_TYPES } from "./session-store.port-fork-commit-bundle.js";
export type { SessionEntryType } from "./session-store.port-fork-commit-bundle.js";
export type { SessionEntryInfo } from "./session-store.port-fork-commit-bundle.js";
export type { SessionInputDelivery } from "./session-store.port-fork-commit-bundle.js";
export type { SessionInputStatus } from "./session-store.port-repair-remote-session-paths-input.js";
export type { SessionInputRecord } from "./session-store.port-repair-remote-session-paths-input.js";
export type { UsageQuerySource } from "./session-store.port-repair-remote-session-paths-input.js";
export type { UsageStatus } from "./session-store.port-repair-remote-session-paths-input.js";
export type { ModelUsageRecord } from "./session-store.port-repair-remote-session-paths-input.js";
export type { TurnUsageRecord } from "./session-store.port-repair-remote-session-paths-input.js";
export type { ToolUsageRecord } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageQueryInput } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageTotalsRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageTurnTotalsRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageToolTotalsRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageModelRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageToolRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageDayRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageDayModelRow } from "./session-store.port-repair-remote-session-paths-input.js";
export type { AppUsageQueryResult } from "./session-store.port-repair-remote-session-paths-input.js";
export type { TaskUsageQueryInput } from "./session-store.port-repair-remote-session-paths-input.js";
export type { TaskUsageQueryResult } from "./session-store.port-repair-remote-session-paths-input.js";
export type { UsageStorePort } from "./session-store.port-usage-store-port.js";
export type { LocalSettingStorePort } from "./session-store.port-usage-store-port.js";
