import { randomUUID } from "node:crypto";
import { buildExecutionStateEntry, readRuntimeExecutionState } from "../execution-state.js";
import {
  CoreErrorType,
  SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
  createCoreError,
  createSessionId,
} from "../deps.js";
import type {
  MessageId,
  SessionEntryInfo,
  TargetCompletionVerificationPayload,
  MessageWithParts,
  SessionId,
  SessionInfo,
  SessionStorePort,
} from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { StableConversationForkChildMetadata } from "../types.js";
import {
  buildForkedSessionInput,
  stableForkError,
  asRecord,
} from "./session-fork-stable-fork-error.js";

export async function createForkedSession(
  runtime: AgentRuntimeInternal,
  options: {
    parentSession: SessionInfo;
    forkedSessionId?: SessionId;
    stableForkMetadata?: StableConversationForkChildMetadata;
  },
): Promise<SessionId> {
  if (!runtime.sessionStore) {
    throw createCoreError(CoreErrorType.ConfigurationError, "Fork requires a session adapter.", {
      context: {
        hasSessionStore: false,
      },
      recoverable: true,
    });
  }

  const forkedSessionId = options.forkedSessionId ?? createSessionId();
  const input = buildForkedSessionInput(runtime, options.parentSession, forkedSessionId);
  // legacy workspace fork 兼容分支。V4 stable/compact-edit 入口直接构建完整 bundle，
  // 不得经过这里的 child-only metadata 原语，否则会重新引入逐条补写窗口。
  if (options.stableForkMetadata) {
    if (!runtime.sessionStore.createForkedSessionWithMetadata) {
      throw stableForkError("Stable fork requires atomic child metadata persistence", {
        forkedSessionId,
        sourceCommandId: options.stableForkMetadata.sourceCommandId,
      });
    }
    const persisted = await runtime.sessionStore.createForkedSessionWithMetadata(
      input,
      options.stableForkMetadata,
    );
    return persisted.id;
  } else {
    await runtime.sessionStore.createSession(input);
  }

  await runtime.sessionStore.saveSessionEntry?.(
    buildExecutionStateEntry(forkedSessionId, readRuntimeExecutionState(runtime)),
  );
  return forkedSessionId;
}

export function conversationHistoryBeforeInput(
  activeMessages: readonly MessageWithParts[],
  targetMessageId: MessageId,
): MessageWithParts[] {
  const targetIndex = activeMessages.findIndex((message) => message.info.id === targetMessageId);
  if (targetIndex < 0) {
    throw stableForkError(`Fork target input not found: ${targetMessageId}`, {
      targetMessageId,
    });
  }
  const target = activeMessages[targetIndex];
  if (target?.info.role !== "user") {
    throw stableForkError("Fork-before-input target is not a user message", {
      targetMessageId,
    });
  }
  return activeMessages.slice(0, targetIndex);
}

export async function copyGoalVerificationEntriesForFork(
  sessionStore: SessionStorePort,
  options: {
    forkedSessionId: SessionId;
    messageIdMap: Map<MessageId, MessageId>;
    parentSessionId: SessionId;
    parentTargetId: string;
    verificationEntryIds?: ReadonlySet<string>;
  },
): Promise<TargetCompletionVerificationPayload[]> {
  if (!sessionStore.sessionEntries || !sessionStore.saveSessionEntry) {
    if (options.verificationEntryIds?.size) {
      throw stableForkError("Stable fork verifier boundary cannot be loaded", {
        verificationEntryIds: [...options.verificationEntryIds],
      });
    }
    return [];
  }

  const parentEntries = await sessionStore.sessionEntries({
    sessionID: options.parentSessionId,
    type: SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
  });
  const copiedPayloads: TargetCompletionVerificationPayload[] = [];
  const remainingEntryIds = options.verificationEntryIds
    ? new Set(options.verificationEntryIds)
    : null;
  for (const parentEntry of parentEntries) {
    if (options.verificationEntryIds && !options.verificationEntryIds.has(parentEntry.id)) {
      continue;
    }
    remainingEntryIds?.delete(parentEntry.id);
    const cloned = cloneGoalVerificationEntryForFork(parentEntry, options);
    if (!cloned) {
      if (options.verificationEntryIds) {
        throw stableForkError("Stable fork verifier is outside the fixed transcript cut", {
          verificationEntryId: parentEntry.id,
        });
      }
      continue;
    }
    await sessionStore.saveSessionEntry(cloned.entry);
    copiedPayloads.push(cloned.payload);
  }
  if (remainingEntryIds?.size) {
    throw stableForkError("Stable fork verifier boundary references missing entries", {
      verificationEntryIds: [...remainingEntryIds],
    });
  }
  return copiedPayloads;
}

export function cloneGoalVerificationEntryForFork(
  entry: SessionEntryInfo,
  options: {
    forkedSessionId: SessionId;
    messageIdMap: Map<MessageId, MessageId>;
    parentTargetId: string;
  },
): { entry: SessionEntryInfo; payload: TargetCompletionVerificationPayload } | null {
  const data = asRecord(entry.data);
  const payload = asRecord(data.payload);
  if (payload.targetId !== options.parentTargetId) {
    return null;
  }
  const anchorAssistantMessageId =
    typeof payload.anchorAssistantMessageId === "string"
      ? (payload.anchorAssistantMessageId as MessageId)
      : null;
  // anchor 在场但不在 messageIdMap = 被验证的 assistant 在 fork 点之后（未复制）：
  // 这是 fork 历史边界过滤，正确跳过——child 只继承 fork 点前的 verifier timeline。
  if (anchorAssistantMessageId && !options.messageIdMap.has(anchorAssistantMessageId)) {
    return null;
  }
  const childAnchorAssistantMessageId = anchorAssistantMessageId
    ? options.messageIdMap.get(anchorAssistantMessageId)
    : undefined;

  // legacy entry 无 anchor 时不再整条静默跳过——verifier
  // 事实仍复制（无法按 anchor 判边界，宁可保留供溯源），本地 anchor 缺省、读取端
  // 按「无 anchor 落已知末尾」处理。anchorTurnId 指向父 runtime turn（child 不存在
  // 该轮），恒降级 originAnchorTurnId。
  const clonedPayloadRecord: Record<string, unknown> = { ...payload };
  if (childAnchorAssistantMessageId) {
    clonedPayloadRecord.anchorAssistantMessageId = childAnchorAssistantMessageId;
  }
  if (typeof payload.anchorTurnId === "string") {
    delete clonedPayloadRecord.anchorTurnId;
    clonedPayloadRecord.originAnchorTurnId = payload.anchorTurnId;
  }
  const clonedPayload = clonedPayloadRecord as unknown as TargetCompletionVerificationPayload;
  const eventId = randomUUID();
  return {
    entry: {
      ...entry,
      id: `fork_goal_verify_${eventId}`,
      sessionID: options.forkedSessionId,
      // verifier entry 是 goal iteration 的持久边界；fork 后必须复制到
      // child session，并把 anchor assistant 改写为 child message id，避免 UI 恢复时丢分割线。
      data: {
        ...data,
        eventId,
        payload: clonedPayload,
      },
    },
    payload: clonedPayload,
  };
}

export function resolveForkHistoryEndIndex(
  messages: MessageWithParts[],
  targetIndex: number,
  expandAssistantTurn: boolean,
): number {
  const target = messages[targetIndex];
  if (!expandAssistantTurn || target?.info.role !== "assistant") {
    return targetIndex + 1;
  }

  const parentId = target.info.parentID;
  let endIndex = targetIndex + 1;
  for (let index = targetIndex + 1; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.info.role !== "assistant" || message.info.parentID !== parentId) {
      break;
    }
    endIndex = index + 1;
  }
  return endIndex;
}

export function isActiveCompactionBoundaryMessage(message: MessageWithParts): boolean {
  return message.parts.some(
    (part) => part.type === "compaction" && (Boolean(part.compactBoundary) || !part.timelineStatus),
  );
}

export function isRealVisibleUserMessage(message: MessageWithParts): boolean {
  return (
    message.info.role === "user" &&
    message.info.synthetic !== true &&
    message.info.visibility !== "model-only" &&
    !message.info.source &&
    !message.info.summary &&
    !isActiveCompactionBoundaryMessage(message)
  );
}

export function findCompactedForkParentUserMessage(
  parentMessages: MessageWithParts[],
  forkHistoryMessages: MessageWithParts[],
  target: MessageWithParts | undefined,
): MessageWithParts | undefined {
  if (target?.info.role !== "assistant") {
    return undefined;
  }
  const parentMessageId = target.info.parentID;
  if (
    !parentMessageId ||
    forkHistoryMessages.some((message) => message.info.id === parentMessageId)
  ) {
    return undefined;
  }
  if (!forkHistoryMessages.some(isActiveCompactionBoundaryMessage)) {
    return undefined;
  }

  const parentUserMessage = parentMessages.find((message) => message.info.id === parentMessageId);
  return parentUserMessage && isRealVisibleUserMessage(parentUserMessage)
    ? parentUserMessage
    : undefined;
}

export function buildForkHistoryMessages(
  parentMessages: MessageWithParts[],
  forkSourceMessages: MessageWithParts[],
  targetIndex: number,
  forkHistoryEndIndex: number,
): MessageWithParts[] {
  const forkHistoryMessages = forkSourceMessages.slice(0, forkHistoryEndIndex);
  const compactedParentUserMessage = findCompactedForkParentUserMessage(
    parentMessages,
    forkHistoryMessages,
    forkSourceMessages[targetIndex],
  );
  if (!compactedParentUserMessage) {
    return forkHistoryMessages;
  }

  // compact 后 active branch 只剩 summary user + assistant，summary 会被 UI 过滤。
  // fork 到该 assistant 时仍要把它 parentID 指向的真实用户输入放回 compact boundary 前，
  // 这样历史可见气泡不丢，同时 resume 仍从最后一个 compact boundary 开始，不改变模型上下文。
  return [compactedParentUserMessage, ...forkHistoryMessages];
}
