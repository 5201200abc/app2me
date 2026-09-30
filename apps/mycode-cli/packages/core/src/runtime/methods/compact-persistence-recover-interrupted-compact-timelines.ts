import { createModelId, createModelProviderId } from "@mycode/contracts";
import {
  CompactTrigger,
  CompactTimelineStatus,
  createMessageId,
  createPartId,
  traceContextToLogContext,
} from "../deps.js";
import type {
  CompactBoundaryPayload,
  MessageId,
  MessageWithParts,
  Model,
  TraceContext,
} from "../deps.js";
import { defaultCompactPhaseForTrigger, defaultCompactReasonForTrigger } from "../helpers/index.js";
import type { CompactTimelineContext } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  isRuntimeAttachmentEntry,
  type RuntimeMessageEntry,
  type RuntimeMessageMetadata,
} from "../../agent/message-history.js";
import { isRecoverableRunningCompactTimelineStatus } from "./compact-persistence-build-compact-timeline-payload.js";

export async function recoverInterruptedCompactTimelines(
  this: AgentRuntimeInternal,
  messages: MessageWithParts[],
  traceContext: TraceContext,
): Promise<number> {
  if (!this.sessionStore) return 0;

  const boundaryByOperationId = new Map<string, CompactBoundaryPayload>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "compaction" || !part.operationId || !part.compactBoundary) continue;
      boundaryByOperationId.set(part.operationId, part.compactBoundary);
    }
  }

  let recovered = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type !== "compaction" ||
        !isRecoverableRunningCompactTimelineStatus(part.timelineStatus) ||
        !part.operationId
      ) {
        continue;
      }

      const boundary = boundaryByOperationId.get(part.operationId);
      const status = boundary ? CompactTimelineStatus.Completed : CompactTimelineStatus.Interrupted;
      const timeline: CompactTimelineContext = {
        operationId: part.operationId,
        messageId: part.messageID,
        partId: part.id,
        trigger: part.trigger ?? CompactTrigger.Manual,
        phase:
          part.phase ??
          boundary?.phase ??
          defaultCompactPhaseForTrigger(part.trigger ?? CompactTrigger.Manual),
        compactReason:
          part.compactReason ??
          boundary?.compactReason ??
          defaultCompactReasonForTrigger(part.trigger ?? CompactTrigger.Manual),
        startedAt: part.time?.start ?? message.info.time.created,
        preCompactTokenCount: part.preCompactTokenCount,
      };
      const payload = this.buildCompactTimelinePayload(timeline, {
        attempt: part.attempt,
        boundaryId: boundary?.boundaryId,
        endedAt: Date.now(),
        maxAttempts: part.maxAttempts,
        postCompactTokenCount: boundary?.postCompactTokenCount,
        replace: true,
        status,
        summaryMessageId: boundary?.summaryMessageIds[0],
        tailStartMessageId: boundary?.lastSummarizedMessageId,
        truePostCompactTokenCount: boundary?.truePostCompactTokenCount,
      });
      await this.persistCompactTimeline(payload, traceContext);
      Object.assign(part, {
        timelineStatus: payload.status,
        phase: payload.phase,
        compactReason: payload.compactReason,
        replace: payload.replace,
        attempt: payload.attempt,
        maxAttempts: payload.maxAttempts,
        boundaryId: payload.boundaryId,
        summaryMessageId: payload.summaryMessageId,
        tail_start_id: payload.tailStartMessageId,
        postCompactTokenCount: payload.postCompactTokenCount,
        truePostCompactTokenCount: payload.truePostCompactTokenCount,
        time: {
          start: payload.startedAt,
          end: payload.endedAt,
        },
      });
      recovered += 1;
    }
  }

  return recovered;
}

export async function persistCompactReminderMessage(
  this: AgentRuntimeInternal,
  entry: RuntimeMessageEntry,
  created: number,
  traceContext: TraceContext,
  model?: Model,
): Promise<MessageId | undefined> {
  if (!this.sessionStore || !isRuntimeAttachmentEntry(entry)) return;

  const messageID = createMessageId();
  const currentModel = resolvePersistedModel(this, model);
  try {
    await this.persistMessage(
      {
        id: messageID,
        sessionID: this.sessionId,
        role: "user",
        time: {
          created,
        },
        agent: this.config.agentName ?? "mycode-agent",
        metadata: compactReminderPartMetadata(entry.metadata),
        modelSelection: currentModel,
        semantics: {
          origin: "agent_runtime",
          kind: "system_reminder",
          source: String(entry.metadata.source ?? "compact_reminder"),
          uiVisibility: "hidden",
          providerVisibility: "visible",
          transcriptVisibility: "hidden",
        },
        system: this.config.systemPrompt,
        synthetic: true,
        tools: Object.fromEntries(this.getTools().map((tool) => [tool.name, true])),
        visibility: "model-only",
      },
      traceContext,
    );
    await this.persistPart(
      {
        id: createPartId(),
        sessionID: this.sessionId,
        messageID,
        type: "text",
        text: entry.content,
        synthetic: true,
        time: {
          start: created,
          end: created,
        },
        metadata: compactReminderPartMetadata(entry.metadata),
      },
      traceContext,
    );
    return messageID;
  } catch (error) {
    await removeCompactPersistenceMessagesBestEffort.call(this, [messageID], traceContext);
    throw error;
  }
}

export function resolvePersistedModel(runtime: AgentRuntimeInternal, model?: Model) {
  if (model) return { providerId: model.providerId, modelId: model.modelId };
  const selection = runtime.getSessionModelSelection();
  return selection
    ? {
        providerId: createModelProviderId(selection.providerId),
        modelId: createModelId(selection.modelId),
      }
    : undefined;
}

export async function removeCompactPersistenceMessagesBestEffort(
  this: AgentRuntimeInternal,
  messageIds: readonly MessageId[],
  traceContext: TraceContext,
): Promise<void> {
  if (!this.sessionStore) return;

  for (const rollbackMessageId of new Set(messageIds)) {
    try {
      await this.sessionStore.removeMessage({
        sessionID: this.sessionId,
        messageID: rollbackMessageId,
      });
    } catch (cleanupError) {
      this.logger?.warn("Compact persistence cleanup failed", {
        ...traceContextToLogContext(traceContext),
        errorMessage: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        event: "compact.persistence.cleanup_failed",
        messageId: rollbackMessageId,
        module: "core.runtime",
      });
    }
  }
}

export function compactReminderPartMetadata(
  runtimeMessage: RuntimeMessageMetadata,
): Record<string, unknown> {
  return {
    runtimeMessage,
    source: runtimeMessage.source,
    visibility: "model-only",
  };
}
