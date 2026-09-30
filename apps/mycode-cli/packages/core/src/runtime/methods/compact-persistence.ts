import { createPartId } from "../deps.js";
import type { CompactBoundaryPayload, MessageId, Model, TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { isRuntimeAttachmentEntry, type RuntimeMessageEntry } from "../../agent/message-history.js";
import {
  resolvePersistedModel,
  persistCompactReminderMessage,
  removeCompactPersistenceMessagesBestEffort,
} from "./compact-persistence-recover-interrupted-compact-timelines.js";

export async function persistCompactSummary(
  this: AgentRuntimeInternal,
  messageID: MessageId,
  content: string,
  summary: string,
  compactBoundary: CompactBoundaryPayload,
  traceContext: TraceContext,
  options?: {
    model?: Model;
    operationId?: string;
    postCompactReminderEntries?: readonly RuntimeMessageEntry[];
  },
): Promise<void> {
  if (!this.sessionStore) return;

  const created = Date.now();
  const persistedModel = resolvePersistedModel(this, options?.model);
  // compact summary 和后续 reminder 是同一次历史替换；任一步失败都要一起回滚。
  const persistedMessageIds: MessageId[] = [messageID];
  try {
    await this.persistMessage(
      {
        id: messageID,
        sessionID: this.sessionId,
        role: "user",
        time: {
          created,
        },
        summary: {
          title: "Compact summary",
          body: summary,
          diffs: [],
        },
        agent: this.config.agentName ?? "mycode-agent",
        modelSelection: persistedModel,
        semantics: {
          origin: "agent_runtime",
          kind: "compact_summary",
          uiVisibility: "hidden",
          providerVisibility: "visible",
          transcriptVisibility: "hidden",
        },
        system: this.config.systemPrompt,
        tools: Object.fromEntries(this.getTools().map((tool) => [tool.name, true])),
      },
      traceContext,
    );
    await this.persistPart(
      {
        id: createPartId(),
        sessionID: this.sessionId,
        messageID,
        type: "text",
        text: content,
        synthetic: true,
        time: {
          start: created,
          end: created,
        },
      },
      traceContext,
    );
    await this.persistPart(
      {
        id: createPartId(),
        sessionID: this.sessionId,
        messageID,
        type: "compaction",
        auto: compactBoundary.trigger === "auto",
        trigger: compactBoundary.trigger,
        phase: compactBoundary.phase,
        compactReason: compactBoundary.compactReason,
        tail_start_id: compactBoundary.lastSummarizedMessageId,
        compactBoundary,
        operationId: options?.operationId,
      },
      traceContext,
    );
    for (const entry of options?.postCompactReminderEntries ?? []) {
      if (!isRuntimeAttachmentEntry(entry)) continue;
      const reminderMessageId = await persistCompactReminderMessage.call(
        this,
        entry,
        created,
        traceContext,
        options?.model,
      );
      if (reminderMessageId) persistedMessageIds.push(reminderMessageId);
    }
  } catch (error) {
    await removeCompactPersistenceMessagesBestEffort.call(this, persistedMessageIds, traceContext);
    throw error;
  }
}

export { buildCompactTimelinePayload } from "./compact-persistence-build-compact-timeline-payload.js";
export { persistCompactTimeline } from "./compact-persistence-build-compact-timeline-payload.js";
export { finishCompactTimelineFailure } from "./compact-persistence-build-compact-timeline-payload.js";
export { recoverInterruptedCompactTimelines } from "./compact-persistence-recover-interrupted-compact-timelines.js";
