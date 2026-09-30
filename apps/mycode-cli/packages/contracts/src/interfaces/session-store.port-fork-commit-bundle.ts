import type { MessageId, PartId, ProjectId, SessionId, WorkspaceId } from "./shared.js";
import type { ModelId, ModelProviderId } from "../model/index.js";
import type { SessionGoal, GoalStatus } from "../tools/target.js";
import type { PermissionRuleset } from "./permission.port.js";
import {
  type CreateSessionInput,
  type ForkCommandResult,
  type SessionTitleSource,
  type FileDiff,
  type SessionRevert,
  type SessionTaskType,
  type AssistantErrorInfo,
  type TokenUsageInfo,
} from "./session-store.port-session-task-types.js";
import {
  type FilePart,
  type TextPart,
  type ReasoningPart,
  type AgentPart,
  type CompactionPart,
  type TimelinePart,
  type MessageInfo,
} from "./session-store.port-assistant-message-info.js";

/**
 * conversation fork 的唯一原子提交载荷。core 在内存完成 remap；adapter 不参与业务裁决，
 * 只保证 child/copy/goal/entries/input/parent command fact 全有或全无。
 */
export interface ForkCommitBundle {
  child: CreateSessionInput;
  messages: MessageWithParts[];
  entries: SessionEntryInfo[];
  /** 存储复制来源（目标 ID -> 父记录 ID）；只保留旧磁盘快照，不参与模型选择。 */
  copySources?: { messages: Record<string, string>; parts: Record<string, string> };
  goal?: { source: SessionGoal; status: GoalStatus };
  initialInput?: {
    id: string;
    sessionID: SessionId;
    kind: string;
    delivery: SessionInputDelivery;
    payload: { text: string; [key: string]: unknown };
  };
  commandFact: {
    parentSessionId: string;
    sourceCommandId: string;
    ack: {
      commandId: string;
      status: "accepted";
      revisionAtDecision: number;
      result: ForkCommandResult;
    };
    metadata: Record<string, unknown>;
  };
}

export interface UpdateSessionInput {
  id: SessionId;
  directory?: string;
  path?: string | null;
  timeUpdated?: number;
  title?: string;
  titleSource?: SessionTitleSource;
  titleMessageID?: MessageId | null;
  expectedTitleSources?: readonly SessionTitleSource[];
  shareURL?: string | null;
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
    diffs?: FileDiff[];
  } | null;
  revert?: SessionRevert | null;
  permission?: PermissionRuleset | null;
  timeCompacting?: number | null;
  timeArchived?: number | null;
}

export interface ListSessionsInput {
  projectID?: ProjectId;
  /** undefined = 不按 identity 过滤；null = 仅本地/legacy 空 identity；字符串 = 精确 workspace identity。 */
  workspaceID?: WorkspaceId | null;
  directory?: string;
  path?: string;
  roots?: boolean;
  taskTypes?: SessionTaskType[];
  includeArchived?: boolean;
  limit?: number;
}

export interface ClaimLegacySessionWorkspaceInput {
  sessionIDs: SessionId[];
  directory: string;
  workspaceID: WorkspaceId;
}

export interface RepairLegacyRemoteSessionWorkspaceInput {
  sessionID: SessionId;
  projectID: ProjectId;
  legacyWorkspaceDirectory: string;
  workspaceID: WorkspaceId;
  workspacePath: string;
}

export interface SubtaskPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
  model?: {
    providerId: ModelProviderId;
    modelId: ModelId;
  };
  command?: string;
}

export interface RetryPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "retry";
  attempt: number;
  error: AssistantErrorInfo;
  time: {
    created: number;
  };
}

export interface StepStartPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "step-start";
  snapshot?: string;
}

export interface StepFinishPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "step-finish";
  reason: string;
  snapshot?: string;
  cost: number;
  tokens: TokenUsageInfo;
}

export interface SnapshotPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "snapshot";
  snapshot: string;
}

export interface PatchPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "patch";
  hash: string;
  files: string[];
}

export interface ToolStatePending {
  status: "pending";
  input: Record<string, unknown>;
  raw: string;
}

export interface ToolStateRunning {
  status: "running";
  input: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
  };
}

export interface ToolStateCompleted {
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  time: {
    start: number;
    end: number;
    compacted?: number;
  };
  attachments?: FilePart[];
}

export interface ToolStateError {
  status: "error";
  input: Record<string, unknown>;
  error: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
    end: number;
  };
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

export interface ToolPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "tool";
  callID: string;
  /** 同一 assistant 内本地工具的声明序号；旧记录可缺失，不能用落盘顺序代替。 */
  declarationIndex?: number;
  tool: string;
  state: ToolState;
  metadata?: Record<string, unknown>;
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | FilePart
  | AgentPart
  | CompactionPart
  | TimelinePart
  | SubtaskPart
  | RetryPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | ToolPart;

export interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

export const SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION =
  "target_completion_verification" as const;

export const SESSION_ENTRY_BASH_SHELL_SELECTION = "runtime/bash_shell_selection" as const;

export const SESSION_ENTRY_MODEL_SELECTION = "runtime/model_selection" as const;

export const SESSION_ENTRY_EXECUTION_STATE = "runtime/execution_state" as const;

export const SESSION_ENTRY_USER_INPUT_AUTO_RESOLUTION =
  "runtime/user_input_auto_resolution" as const;

export const SESSION_ENTRY_WORKSPACE_CHECKPOINT = "runtime/workspace_checkpoint" as const;

export const SESSION_ENTRY_WORKSPACE_FILE_REWIND = "runtime/workspace_file_rewind" as const;

export const SESSION_ENTRY_TYPES = [
  SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
  SESSION_ENTRY_BASH_SHELL_SELECTION,
  SESSION_ENTRY_MODEL_SELECTION,
  SESSION_ENTRY_EXECUTION_STATE,
  SESSION_ENTRY_USER_INPUT_AUTO_RESOLUTION,
  SESSION_ENTRY_WORKSPACE_CHECKPOINT,
  SESSION_ENTRY_WORKSPACE_FILE_REWIND,
] as const;

export type SessionEntryType = (typeof SESSION_ENTRY_TYPES)[number];

export interface SessionEntryInfo {
  id: string;
  sessionID: SessionId;
  type: SessionEntryType | string;
  // session entry 既承载用户/工具活动，也承载 session-local 配置快照。
  // 配置恢复或切换只应更新 entry 自己的版本，不能把任务活动时间伪装成“刚刚”。
  touchSession?: boolean;
  time: {
    created: number;
    updated: number;
  };
  /**
   * 逻辑 payload，不等同于数据库 JSON。runtime/model_selection 的读写为公共
   * ModelSelection（无选择沿用 null）；SQLite adapter 负责 modelSelection 包装，
   * 旧平铺字段仅供一次性迁移/回滚，不能暴露给普通消费者或复制到 fork 子记录。
   */
  data: unknown;
}

// ── session_input 账本──
// 输入的 durable 生命周期：admitted（已接受，排队/待注入）→ promoted（已消费成
// transcript user message，与消息持久化同事务）/ cancelled（用户删除队列项等）/
// discarded（session_resumed=重启不保留队列；user_cleared=heldQueue 清空发送）/
// failed（已接受但运行时无法启动；保留终态，重启时禁止再改写成 discarded）。
// id = input/command id（admission 时即存在）；promoted_message_id 是 nullable 外键——
// messageId 在 drain 时才生成。startNow 也必须先经过 durable admission：即使 CLI 在 ACK 后、
// user message 原子 promotion 前崩溃，恢复端也能把输入明确标成 discarded。
export type SessionInputDelivery = "startNow" | "guide" | "queue";
