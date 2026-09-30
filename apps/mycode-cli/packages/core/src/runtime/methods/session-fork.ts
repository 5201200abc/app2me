import { resolveExecutionState } from "@mycode/shared";
import { buildExecutionStateEntry, readRuntimeExecutionState } from "../execution-state.js";
import { type ForkCommitBundle } from "@mycode/contracts";
import {
  RewindStrategy,
  SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
  SessionEventType,
  createMessageId,
  createSessionId,
  traceContextToLogContext,
} from "../deps.js";
import type { MessageId, MessageWithParts, SessionId, SessionInfo, TraceContext } from "../deps.js";
import { cloneMessageForFork, clonePartForFork } from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type {
  StableConversationForkGoalBoundary,
  StableConversationForkOptions,
  ConversationBeforeInputForkOptions,
  SelectionSideChatCreateOptions,
  StableConversationForkTarget,
  WorkspaceForkResult,
} from "../types.js";
import type { ModelSelection } from "@mycode/contracts";
import {
  stableForkError,
  resolveForkModelSelection,
  collectVerifierEntryIds,
  collectForkGoalSnapshots,
  buildModelSelectionEntry,
  buildForkedSessionInput,
} from "./session-fork-stable-fork-error.js";
import {
  withoutSelectionSideChatGoalBoundary,
  buildSelectionSideChatBoundary,
  buildAtomicForkNotice,
  forkSourceMessagesForSession,
  selectionSideChatHistoryMessages,
} from "./session-fork-fork-source-messages-for-session.js";
import {
  createForkIdentityMap,
  cloneVerifierEntryForAtomicFork,
  remapGoalForFork,
} from "./session-fork-create-fork-identity-map.js";
import { stableForkHistoryMessages } from "./session-fork-stable-fork-history-messages.js";
import { conversationHistoryBeforeInput } from "./session-fork-create-forked-session.js";

async function commitAtomicConversationFork(
  runtime: AgentRuntimeInternal,
  options: {
    commandFact?: ForkCommitBundle["commandFact"];
    modelSelection?: ModelSelection;
    forkedSessionId?: SessionId;
    goalBoundary: StableConversationForkGoalBoundary;
    initialInput?: ForkCommitBundle["initialInput"];
    messages: readonly MessageWithParts[];
    parentSession: SessionInfo;
    revisionAtDecision?: number;
    sourceCommandId: string;
    targetMessageId: MessageId;
    target?: StableConversationForkTarget;
    traceContext: TraceContext;
    kind?: "fork" | "selection_side_chat";
  },
): Promise<WorkspaceForkResult> {
  const store = runtime.sessionStore;
  if (!store?.commitForkBundle) {
    throw stableForkError("Stable fork requires commitForkBundle");
  }
  const childSessionId = options.forkedSessionId ?? createSessionId();
  const kind = options.kind ?? "fork";
  const currentExecutionState = readRuntimeExecutionState(runtime);
  const historicalInfo = [...options.messages]
    .reverse()
    .find((message) => message.info.role === "assistant")?.info;
  // 保留原 stable fork 的历史权限选择，不能让新增 entry 把它覆盖成父任务当前权限。
  const executionState =
    kind === "selection_side_chat" || historicalInfo?.role !== "assistant"
      ? currentExecutionState
      : resolveExecutionState(historicalInfo);
  // 辅助对话明确不复制 Goal target/verifier entries，不能仍将
  // 父消息的 goalBoundary 交给 strict fork clone，否则任意 Goal 状态都会要求不存在的
  // child-local identity。只移除用于 Goal 恢复的 boundary，保留父对话正文作为模型上下文。
  const sourceMessages =
    kind === "selection_side_chat"
      ? options.messages.map(withoutSelectionSideChatGoalBoundary)
      : options.messages;
  const modelSelection = resolveForkModelSelection(runtime, sourceMessages, options.modelSelection);
  const referencedEntryIds =
    kind === "selection_side_chat"
      ? new Set<string>()
      : collectVerifierEntryIds(sourceMessages, options.goalBoundary);
  const allEntries = referencedEntryIds.size
    ? await store.sessionEntries?.({
        sessionID: runtime.sessionId,
        type: SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
      })
    : [];
  if (referencedEntryIds.size && !allEntries) {
    throw stableForkError("Stable fork verifier boundary cannot be loaded");
  }
  const entryById = new Map((allEntries ?? []).map((entry) => [entry.id, entry]));
  const entries = [...referencedEntryIds].map((id) => {
    const entry = entryById.get(id);
    if (!entry) {
      throw stableForkError("Stable fork verifier boundary references missing entries", {
        verificationEntryId: id,
      });
    }
    return entry;
  });
  const goalSnapshots =
    kind === "selection_side_chat"
      ? []
      : collectForkGoalSnapshots(sourceMessages, options.goalBoundary);
  const identities = createForkIdentityMap({
    childSessionId,
    entries,
    goalSnapshots,
    messages: sourceMessages,
    parentSessionId: runtime.sessionId,
  });
  const copiedMessages = sourceMessages.map((message) => {
    const nextMessageId = identities.messageIds.get(message.info.id)!;
    const cloned = {
      info: cloneMessageForFork(message.info, {
        forkedSessionId: childSessionId,
        messageIdMap: identities.messageIds,
        nextMessageId,
        turnIdMap: identities.turnIds,
        productTurnIdMap: identities.productTurnIds,
        targetIdMap: identities.targetIds,
        verificationEntryIdMap: identities.verifierEntryIds,
        strictLocalReferences: true,
      }),
      parts: message.parts.map((part) =>
        clonePartForFork(part, {
          forkedSessionId: childSessionId,
          nextMessageId,
          nextPartId: identities.partIds.get(part.id),
          partIdMap: identities.partIds,
          messageIdMap: identities.messageIds,
          turnIdMap: identities.turnIds,
          targetIdMap: identities.targetIds,
          verificationIdMap: identities.verificationIds,
          toolCallIdMap: identities.toolCallIds,
          strictLocalReferences: true,
        }),
      ),
    };
    if (kind !== "selection_side_chat") return cloned;
    // 副屏继承历史仅供模型参考；UI 从空白副屏开始，避免把它误认成普通 fork。
    return {
      ...cloned,
      info: {
        ...cloned.info,
        visibility: "model-only" as const,
        semantics: {
          origin: cloned.info.semantics?.origin ?? "migration",
          kind: cloned.info.semantics?.kind ?? "system_reminder",
          ...(cloned.info.semantics?.source ? { source: cloned.info.semantics.source } : {}),
          uiVisibility: "hidden" as const,
          providerVisibility: "visible" as const,
          transcriptVisibility: "hidden" as const,
        },
      },
    };
  });
  const clonedEntries = entries.map((entry) => cloneVerifierEntryForAtomicFork(entry, identities));
  const modelSelectionEntry = buildModelSelectionEntry(childSessionId, modelSelection);
  if (kind === "selection_side_chat") {
    copiedMessages.push(buildSelectionSideChatBoundary(runtime, childSessionId, modelSelection));
  } else {
    copiedMessages.push(
      ...buildAtomicForkNotice(runtime, {
        identities,
        modelSelection,
        executionState,
        sourceCommandId: options.sourceCommandId,
        targetMessageId: options.targetMessageId,
      }),
    );
  }
  const commandFact = options.commandFact ?? {
    parentSessionId: String(runtime.sessionId),
    sourceCommandId: options.sourceCommandId,
    ack: {
      commandId: options.sourceCommandId,
      status: "accepted" as const,
      revisionAtDecision: options.revisionAtDecision ?? 0,
      result: {
        type: kind === "selection_side_chat" ? "createSelectionSideSession" : "forkAssistant",
        sessionId: String(childSessionId),
      },
    },
    metadata: {
      forkOrigin: {
        parentSessionId: String(runtime.sessionId),
        targetMessageId: String(options.targetMessageId),
      },
      ...(options.target ? { forkTarget: options.target } : {}),
    },
  };
  const goal =
    kind !== "selection_side_chat" && options.goalBoundary.kind === "snapshot"
      ? {
          source: remapGoalForFork(options.goalBoundary.target, identities),
          status: options.goalBoundary.target.status,
        }
      : undefined;
  const committedChild = await store.commitForkBundle({
    child: buildForkedSessionInput(runtime, options.parentSession, childSessionId, kind),
    messages: copiedMessages,
    copySources: {
      messages: Object.fromEntries(
        [...identities.messageIds].map(([source, target]) => [target, source]),
      ),
      parts: Object.fromEntries(
        [...identities.partIds].map(([source, target]) => [target, source]),
      ),
    },
    // 选型 entry 与 child/message/verifier 同事务提交；否则 child 首次注册能读到
    // 运行态，冷恢复却会回到 workspace 默认 thought。entry 的磁盘包装由 adapter 负责。
    // Plan 必须与权限一并进入原子的 child bundle，不能只复制创建时的旧 permission。
    entries: [
      ...clonedEntries.map((item) => item.entry),
      modelSelectionEntry,
      buildExecutionStateEntry(childSessionId, executionState),
    ],
    ...(goal ? { goal } : {}),
    ...(options.initialInput ? { initialInput: options.initialInput } : {}),
    commandFact,
  });
  const forkedSessionId = committedChild.id;
  if (kind !== "selection_side_chat") {
    const forkedEvent = runtime.createEvent(
      SessionEventType.SessionForked,
      {
        originalSessionId: runtime.sessionId,
        forkedSessionId,
        forkPoint: options.messages.length,
        targetMessageId: options.targetMessageId,
        restoredFileCount: 0,
        strategy: RewindStrategy.ForkRequired,
      },
      options.traceContext,
    );
    try {
      await runtime.appendEvent(forkedEvent, options.traceContext);
    } catch (error) {
      runtime.logger?.warn("Parent fork event append failed after durable fork commit", {
        ...traceContextToLogContext(options.traceContext),
        error: error instanceof Error ? error.message : String(error),
        event: "session.fork.parent_event.failed_after_commit",
        forkedSessionId,
        module: "core.runtime",
        parentSessionId: runtime.sessionId,
      });
    }
  }
  return {
    copiedMessageCount: options.messages.length,
    forkedSessionId,
    parentSessionId: runtime.sessionId,
    targetMessageId: options.targetMessageId,
    restoredFiles: [],
    response:
      kind === "selection_side_chat"
        ? `Created selection side chat ${forkedSessionId}.`
        : `Forked session ${forkedSessionId} from message ${options.targetMessageId}: copied ${options.messages.length} messages.`,
  };
}

/**
 * 副屏创建使用父 active transcript 的稳定落盘边界。正在生成时只保留已提交的本轮
 * real-user input，排除其后的 assistant/tool 增量；goal、queue 与阻塞运行态不复制。
 */
export async function createSelectionSideConversation(
  this: AgentRuntimeInternal,
  options: SelectionSideChatCreateOptions,
): Promise<WorkspaceForkResult> {
  if (!options.sourceCommandId.trim()) {
    throw stableForkError("Selection side chat sourceCommandId must not be empty");
  }
  if (!this.sessionStore?.commitForkBundle) {
    throw stableForkError("Selection side chat requires commitForkBundle");
  }
  const parentSession = await this.sessionStore.getSession(this.sessionId);
  if (!parentSession) throw stableForkError(`Session not found: ${this.sessionId}`);
  const parentMessages = await this.sessionStore.messages({ sessionID: this.sessionId });
  const activeMessages = forkSourceMessagesForSession(parentMessages, parentSession);
  const history = selectionSideChatHistoryMessages(activeMessages, this.activeTurn?.turnId);
  const targetMessageId = history.at(-1)?.info.id ?? createMessageId();
  return await commitAtomicConversationFork(this, {
    modelSelection: options.modelSelection,
    goalBoundary: { kind: "none" },
    kind: "selection_side_chat",
    messages: history,
    parentSession,
    revisionAtDecision: options.revisionAtDecision,
    sourceCommandId: options.sourceCommandId,
    targetMessageId,
    traceContext: options.traceContext ?? this.rootTraceContext,
  });
}

/** V4 running stable fork 公共入口：纯 transcript copy，不读取/恢复 workspace checkpoint。 */
export async function forkStableConversationAtMessage(
  this: AgentRuntimeInternal,
  options: StableConversationForkOptions,
): Promise<WorkspaceForkResult> {
  if (!options.sourceCommandId.trim()) {
    throw stableForkError("Stable fork sourceCommandId must not be empty");
  }
  if (!this.sessionStore?.commitForkBundle) {
    throw stableForkError("Stable fork requires commitForkBundle");
  }
  const parentSession = await this.sessionStore.getSession(this.sessionId);
  if (!parentSession) throw stableForkError(`Session not found: ${this.sessionId}`);
  const parentMessages = await this.sessionStore.messages({ sessionID: this.sessionId });
  const activeMessages = forkSourceMessagesForSession(parentMessages, parentSession);
  const history = stableForkHistoryMessages(activeMessages, options.target);
  return await commitAtomicConversationFork(this, {
    modelSelection: options.modelSelection,
    forkedSessionId: options.forkedSessionId,
    goalBoundary: options.goalBoundary,
    messages: history,
    parentSession,
    revisionAtDecision: options.revisionAtDecision,
    sourceCommandId: options.sourceCommandId,
    target: options.target,
    targetMessageId: options.target.boundaryMessageId as MessageId,
    traceContext: options.traceContext ?? this.rootTraceContext,
  });
}

/** compact-covered edit：复制目标真实用户输入之前的 active conversation prefix。 */
export async function forkConversationBeforeMessage(
  this: AgentRuntimeInternal,
  options: ConversationBeforeInputForkOptions,
): Promise<WorkspaceForkResult> {
  if (!this.sessionStore?.commitForkBundle) {
    throw stableForkError("Fork requires a session adapter");
  }
  const parentSession = await this.sessionStore.getSession(this.sessionId);
  if (!parentSession) throw stableForkError(`Session not found: ${this.sessionId}`);
  const parentMessages = await this.sessionStore.messages({
    sessionID: this.sessionId,
  });
  const activeMessages = forkSourceMessagesForSession(parentMessages, parentSession);
  const prefix = conversationHistoryBeforeInput(activeMessages, options.targetMessageId);
  return await commitAtomicConversationFork(this, {
    commandFact: options.commandFact,
    modelSelection: options.modelSelection,
    forkedSessionId: options.forkedSessionId,
    goalBoundary: options.goalBoundary,
    initialInput: options.initialInput,
    messages: prefix,
    parentSession,
    sourceCommandId: options.sourceCommandId,
    targetMessageId: options.targetMessageId,
    traceContext: options.traceContext ?? this.rootTraceContext,
  });
}

export { createForkedSession } from "./session-fork-create-forked-session.js";
export { forkConversationFromMessage } from "./session-fork-fork-conversation-from-message.js";
export { copyGoalStateForFork } from "./session-fork-fork-conversation-from-message.js";
export { forkSourceMessagesForSession } from "./session-fork-fork-source-messages-for-session.js";
export { resolveForkHistoryEndIndex } from "./session-fork-create-forked-session.js";
export { buildForkHistoryMessages } from "./session-fork-create-forked-session.js";
