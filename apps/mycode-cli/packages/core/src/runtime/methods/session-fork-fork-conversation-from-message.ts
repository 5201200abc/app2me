import {
  CoreErrorType,
  RewindStrategy,
  SessionEventType,
  createCoreError,
  createMessageId,
  createPartId,
  traceContextToLogContext,
} from "../deps.js";
import type {
  GoalStatus,
  MessageId,
  TargetCompletionVerificationPayload,
  SessionId,
  TraceContext,
} from "../deps.js";
import { formatConversationForkNoticeBody } from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { StableConversationForkGoalBoundary, WorkspaceForkResult } from "../types.js";
import { forkSourceMessagesForSession } from "./session-fork-fork-source-messages-for-session.js";
import { stableForkError } from "./session-fork-stable-fork-error.js";
import {
  resolveForkHistoryEndIndex,
  conversationHistoryBeforeInput,
  buildForkHistoryMessages,
  createForkedSession,
  copyGoalVerificationEntriesForFork,
} from "./session-fork-create-forked-session.js";

/** legacy workspace/checkpoint fork；V4 stable 与 compact-edit 禁止调用。 */
export async function forkConversationFromMessage(
  this: AgentRuntimeInternal,
  options: {
    forkedSessionId?: SessionId;
    targetMessageId: MessageId;
    traceContext: TraceContext;
    beforeTarget?: true;
  },
): Promise<WorkspaceForkResult> {
  if (!this.sessionStore) {
    throw createCoreError(CoreErrorType.ConfigurationError, "Fork requires a session adapter.", {
      context: {
        hasSessionStore: false,
      },
      recoverable: true,
    });
  }

  const parentSession = await this.sessionStore.getSession(this.sessionId);
  if (!parentSession) {
    throw createCoreError(CoreErrorType.SessionNotFound, `Session not found: ${this.sessionId}`, {
      context: {
        sessionId: this.sessionId,
      },
      recoverable: true,
    });
  }

  const parentMessages = await this.sessionStore.messages({
    sessionID: this.sessionId,
  });
  // fork 会在编辑重发和压缩后发生，复制源必须是 UI transcript 语义。
  // activeSessionMessages 是模型恢复语义，会按 compact boundary 截掉旧 worklog；
  // fork child 需要保留 fork 点前可见历史，但仍要排除 rewind/edit 后的旧分支。
  const forkSourceMessages = forkSourceMessagesForSession(parentMessages, parentSession);
  const targetIndex = forkSourceMessages.findIndex(
    (message) => message.info.id === options.targetMessageId,
  );
  if (targetIndex < 0) {
    throw stableForkError(
      `Fork target message not found in session store: ${options.targetMessageId}`,
      { messageId: options.targetMessageId },
    );
  }

  const legacyForkHistoryEndIndex = resolveForkHistoryEndIndex(
    forkSourceMessages,
    targetIndex,
    true,
  );
  const forkHistoryMessages = options.beforeTarget
    ? conversationHistoryBeforeInput(forkSourceMessages, options.targetMessageId)
    : buildForkHistoryMessages(
        parentMessages,
        forkSourceMessages,
        targetIndex,
        legacyForkHistoryEndIndex,
      );

  const forkedSessionId = await createForkedSession(this, {
    forkedSessionId: options.forkedSessionId,
    parentSession,
  });
  const { copiedMessageCount, messageIdMap } = await this.copySessionMessagesForFork({
    forkedSessionId,
    messages: forkHistoryMessages,
    traceContext: options.traceContext,
  });
  await copyGoalStateForFork.call(this, {
    forkedSessionId,
    messageIdMap,
    traceContext: options.traceContext,
  });
  // 纯对话 fork 没有 workspace checkpoint，但 UI 仍需要一条结构化 fork notice 渲染分割线。
  // 之前只复制历史消息，导致 forked session 首屏看不到来源边界。
  const copiedTargetMessageId = messageIdMap.get(options.targetMessageId);
  const forkTimelineCreated = Date.now();
  await this.persistAssistantTimelinePartForSession({
    sessionId: forkedSessionId,
    messageID: createMessageId(),
    partID: createPartId(
      `fork_${String(this.sessionId)}_${String(options.targetMessageId)}_timeline`,
    ),
    parentID: copiedTargetMessageId,
    created: forkTimelineCreated,
    completed: forkTimelineCreated,
    finish: "completed",
    timeline: {
      timelineType: "session_fork",
      display: "separator",
      status: "completed",
      anchorMessageId: copiedTargetMessageId,
      parentSessionId: this.sessionId,
      targetMessageId: options.targetMessageId,
      restoredFileCount: 0,
      time: {
        start: forkTimelineCreated,
        end: forkTimelineCreated,
      },
    },
    traceContext: options.traceContext,
  });
  await this.persistSyntheticUserNoticeForSession({
    messageID: createMessageId(),
    sessionId: forkedSessionId,
    source: "fork",
    text: formatConversationForkNoticeBody({
      parentSessionId: this.sessionId,
      targetMessageId: options.targetMessageId,
    }),
    metadata: {
      forkContext: {
        kind: "session_fork",
        parentSessionId: this.sessionId,
        targetMessageId: options.targetMessageId,
        restoredFileCount: 0,
      },
    },
    traceContext: options.traceContext,
  });
  this.logger?.debug("Conversation fork notice persisted", {
    ...traceContextToLogContext(options.traceContext),
    event: "session.fork.notice.persisted",
    forkedSessionId,
    module: "core.runtime",
    parentSessionId: this.sessionId,
    status: "completed",
    targetMessageId: options.targetMessageId,
  });

  const forkedEvent = this.createEvent(
    SessionEventType.SessionForked,
    {
      originalSessionId: this.sessionId,
      forkedSessionId,
      forkPoint: legacyForkHistoryEndIndex,
      targetMessageId: options.targetMessageId,
      restoredFileCount: 0,
      strategy: RewindStrategy.ForkRequired,
    },
    options.traceContext,
  );
  await this.appendEvent(forkedEvent, options.traceContext);

  return {
    copiedMessageCount,
    forkedSessionId,
    parentSessionId: this.sessionId,
    targetMessageId: options.targetMessageId,
    restoredFiles: [],
    response: `Forked session ${forkedSessionId} from message ${options.targetMessageId}: copied ${copiedMessageCount} messages.`,
  };
}

export async function copyGoalStateForFork(
  this: AgentRuntimeInternal,
  options: {
    forkedSessionId: SessionId;
    goalBoundary?: StableConversationForkGoalBoundary;
    messageIdMap: Map<MessageId, MessageId>;
    traceContext: TraceContext;
  },
): Promise<void> {
  const sessionStore = this.sessionStore;
  if (!sessionStore?.cloneTargetForFork) {
    return;
  }

  if (options.goalBoundary?.kind === "none") {
    return;
  }

  const parentTarget =
    options.goalBoundary?.kind === "snapshot"
      ? options.goalBoundary.target
      : await sessionStore.readTarget({ sessionID: this.sessionId });
  if (!parentTarget) return;
  if (
    options.goalBoundary?.kind === "snapshot" &&
    String(parentTarget.sessionID) !== String(this.sessionId)
  ) {
    throw stableForkError("Stable fork goal snapshot belongs to another session", {
      goalSessionId: parentTarget.sessionID,
      parentSessionId: this.sessionId,
    });
  }

  const copiedVerificationPayloads = await copyGoalVerificationEntriesForFork(sessionStore, {
    forkedSessionId: options.forkedSessionId,
    messageIdMap: options.messageIdMap,
    parentSessionId: this.sessionId,
    parentTargetId: parentTarget.targetID,
    ...(options.goalBoundary?.kind === "snapshot"
      ? {
          verificationEntryIds: new Set(options.goalBoundary.verificationEntryIds),
        }
      : {}),
  });
  const forkedStatus =
    options.goalBoundary?.kind === "snapshot"
      ? parentTarget.status
      : deriveForkedGoalStatusFromCopiedVerifications(
          parentTarget.status,
          copiedVerificationPayloads,
        );
  await sessionStore.cloneTargetForFork({
    sessionID: options.forkedSessionId,
    source: parentTarget,
    status: forkedStatus,
  });

  this.logger?.debug("Forked session goal state copied", {
    ...traceContextToLogContext(options.traceContext),
    copiedGoalVerificationCount: copiedVerificationPayloads.length,
    event: "session.fork.goal_state.copied",
    forkedSessionId: options.forkedSessionId,
    module: "core.runtime",
    parentSessionId: this.sessionId,
    targetId: parentTarget.targetID,
  });
}

export function deriveForkedGoalStatusFromCopiedVerifications(
  parentStatus: GoalStatus,
  copiedVerificationPayloads: readonly TargetCompletionVerificationPayload[],
): GoalStatus {
  const latestCompleted = [...copiedVerificationPayloads]
    .reverse()
    .find((payload) => payload.status === "completed" && payload.verification);
  if (latestCompleted?.verification?.passed === true) {
    return "complete";
  }
  if (parentStatus === "complete") {
    return "active";
  }
  return parentStatus;
}
