import { ServiceChannels } from "@mycode/shared";
import type {
  TraceId,
  MyCodeAgentMcpServer,
  MyCodeDeliveryKind,
  MyCodeMessageWithParts,
  ModelSelection,
  MyCodePermissionRequestParams,
  MyCodeUserInputRequestParams,
  MyCodeUserInputResponse,
  MyCodeSessionInfo,
  MyCodeSessionImportHistory,
  MyCodeSessionEvent,
  MyCodeSessionMode,
  MyCodeSessionPersistence,
  MyCodeSessionStateSnapshot,
  MyCodeStateUpdatedNotification,
  MyCodeWorkspacePresentation,
} from "@mycode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface MyCodeSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type MyCodeSessionReadWorkspacePresentationParams = MyCodeSessionWorkspaceTarget;

export interface MyCodeTaskTarget extends MyCodeSessionWorkspaceTarget {
  sessionId: string;
}

export interface MyCodeSessionCreateParams extends MyCodeSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: MyCodeSessionMode;
  model?: ModelSelection;
  persistence?: MyCodeSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: MyCodeAgentMcpServer[];
  importedHistory?: MyCodeSessionImportHistory;
}

export interface MyCodeSessionResumeParams extends MyCodeTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: MyCodeAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface MyCodeSessionListParams extends MyCodeSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface MyCodeSessionReadParams extends MyCodeTaskTarget {
  deliveryKind?: MyCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface MyCodeSessionMessagesParams extends MyCodeTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface MyCodeSessionEventsParams extends MyCodeTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface MyCodeSessionSetModelParams extends MyCodeTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface MyCodeSessionSetThoughtLevelParams extends MyCodeTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface MyCodeSessionSetModeParams extends MyCodeTaskTarget {
  mode: MyCodeSessionMode;
  expectedRevision?: number;
}

export interface MyCodeSessionSubscribeParams extends MyCodeTaskTarget {
  deliveryKind: MyCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type MyCodeSessionServiceEvent =
  | { type: "session.event"; event: MyCodeSessionEvent }
  | { type: "state.updated"; notification: MyCodeStateUpdatedNotification }
  | { type: "permission.request"; request: MyCodePermissionRequestParams }
  | { type: "userInput.request"; request: MyCodeUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: MyCodeUserInputResponse;
    }
  | { type: "snapshot"; snapshot: MyCodeSessionStateSnapshot };

export interface MyCodeSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface MyCodeSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IMyCodeSessionService {
  initializeWorkspace(params: MyCodeSessionWorkspaceTarget): Promise<MyCodeSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: MyCodeSessionWorkspaceTarget,
  ): Promise<MyCodeSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: MyCodeSessionReadWorkspacePresentationParams,
  ): Promise<MyCodeWorkspacePresentation>;
  createSession(params: MyCodeSessionCreateParams): Promise<MyCodeSessionStateSnapshot>;
  resumeSession(params: MyCodeSessionResumeParams): Promise<MyCodeSessionStateSnapshot>;
  listSessions(params: MyCodeSessionListParams): Promise<MyCodeSessionInfo[]>;
  readSession(params: MyCodeSessionReadParams): Promise<MyCodeSessionStateSnapshot>;
  readSessionMessages(params: MyCodeSessionMessagesParams): Promise<MyCodeMessageWithParts[]>;
  readSessionEvents(params: MyCodeSessionEventsParams): Promise<MyCodeSessionEvent[]>;
  promoteDeferredDraftSession(params: MyCodeTaskTarget): Promise<void>;
  closeSession(params: MyCodeTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: MyCodeTaskTarget): Promise<boolean>;
  setModel(params: MyCodeSessionSetModelParams): Promise<MyCodeSessionStateSnapshot>;
  setThoughtLevel(params: MyCodeSessionSetThoughtLevelParams): Promise<MyCodeSessionStateSnapshot>;
  setMode(params: MyCodeSessionSetModeParams): Promise<MyCodeSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IMyCodeSessionService = createServiceDescriptor<IMyCodeSessionService>(
  ServiceChannels.MyCodeSession,
);
