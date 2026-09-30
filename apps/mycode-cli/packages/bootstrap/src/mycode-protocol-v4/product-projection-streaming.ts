import type { AssistantFeedbackUpdatedPayload, SessionEvent } from "@mycode/contracts";

import type {
  AssistantTextRow,
  ConversationDelta,
  ReasoningRow,
} from "@mycode/shared/mycode-protocol-v4";

import { type CanonicalAssistantSegmentFact } from "./event-normalizer.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionStreaming = {
  onModelStreaming(
    this: ProjectionEngine,
    fact: CanonicalAssistantSegmentFact,
  ): ConversationDelta[] {
    const event = fact.event;
    // 迟到终态不复活：非运行期到达的流式事件一律拒收。
    // assistant 守恒：正文类拒收不是无害丢弃——投影建立晚于
    // TurnStarted（订阅中途建 publisher）时，整段回复会静默消失直到刷新
    // （「回复整段消失」的 live 向量）。计数暴露给 gateway：置 stale 标记，
    // 下次订阅强制重新 hydration 从持久事实补齐。
    if (!this.isRunning()) {
      const dropped = fact.stream;
      if (
        dropped.kind === "text_start" ||
        dropped.kind === "text_delta" ||
        dropped.kind === "reasoning_start" ||
        dropped.kind === "reasoning_delta"
      ) {
        this.droppedContentStreamEventCount += 1;
      }
      return [];
    }
    const payload = fact.stream;
    switch (payload.kind) {
      case "text_start":
        return this.openTextRow(event, fact);
      case "text_delta": {
        const open = this.streamingTextRowId === null ? this.openTextRow(event, fact) : [];
        return [
          ...open,
          {
            op: "row.delta",
            rowId: this.streamingTextRowId as number,
            path: "text",
            append: payload.delta,
          },
        ];
      }
      case "text_end":
        return this.closeTextRow("complete");
      case "reasoning_start":
        return this.openReasoningRow(event, fact);
      case "reasoning_delta": {
        const open =
          this.streamingReasoningRowId === null ? this.openReasoningRow(event, fact) : [];
        return [
          ...open,
          {
            op: "row.delta",
            rowId: this.streamingReasoningRowId as number,
            path: "text",
            append: payload.delta,
          },
        ];
      }
      case "reasoning_end":
        return this.closeReasoningRow();
      case "tool_input_start":
        return this.openToolRow(event, payload, fact.entityId);
      case "tool_input_delta": {
        return this.appendStreamingToolInput(event, payload);
      }
      case "tool_input_end":
        return this.flushStreamingToolInput(String(payload.toolCallId ?? ""));
      case "tool_call":
        return this.finalizeStreamingToolInput(event, payload);
      default:
        return [];
    }
  },
  openTextRow(
    this: ProjectionEngine,
    event: SessionEvent,
    fact: CanonicalAssistantSegmentFact,
  ): ConversationDelta[] {
    const close = this.closeTextRow("complete");
    const continuationRowId = this.outputContinuationTextRowId;
    this.outputContinuationTextRowId = null;
    const continuationRow =
      continuationRowId === null ? undefined : this.findRow(continuationRowId);
    const currentTurnId = this.turnIdOf(event);
    const lastVisibleRow = this.snapshot.rows.window.at(-1);
    if (
      continuationRow?.kind === "assistantText" &&
      continuationRow.turnId === currentTurnId &&
      lastVisibleRow?.rowId === continuationRow.rowId
    ) {
      // runtime 的 output-token Continue 会为每次 provider 请求创建新的
      // assistantMessageId；旧投影因此把一句话拆成 history partial + 轮尾正文。length
      // 已经在 ModelComplete 上提供精确资格，这里只重新打开紧邻的同 turn text row，
      // 让外部 continuous/replayable 客户端都只观察到一条持续增长的 assistant。
      const {
        actions: _actions,
        assistantResponseId: _assistantResponseId,
        feedback: _feedback,
        ...continuedBase
      } = continuationRow;
      const row: AssistantTextRow = {
        ...continuedBase,
        entityId: fact.entityId,
        ...(fact.stream.assistantResponseId
          ? { assistantResponseId: fact.stream.assistantResponseId }
          : {}),
        state: "streaming",
      };
      this.streamingTextRowId = row.rowId;
      this.entityIdByRowId.set(row.rowId, fact.entityId);
      const previousMessageId = this.messageIdByRowId.get(row.rowId);
      if (previousMessageId) {
        this.outputContinuationRowIdByMessageId.set(previousMessageId, row.rowId);
      }
      if (fact.transcriptMessageId) {
        this.messageIdByRowId.set(row.rowId, fact.transcriptMessageId);
      }
      return [...close, { op: "row.upserted", row }];
    }

    // 不变量：非 output-token Continue 的新段必然新 rowId；已有 streaming 行先收口。
    const row: AssistantTextRow = {
      ...this.rowBase(event, this.turnIdOf(event), fact.entityId),
      kind: "assistantText",
      ...(fact.stream.assistantResponseId
        ? { assistantResponseId: fact.stream.assistantResponseId }
        : {}),
      text: "",
      state: "streaming",
    };
    this.streamingTextRowId = row.rowId;
    this.entityIdByRowId.set(row.rowId, fact.entityId);
    // forkAssistant 锚点：assistant 行 → 权威 messageId（provider 流首帧即带）。
    if (fact.transcriptMessageId) {
      this.messageIdByRowId.set(row.rowId, fact.transcriptMessageId);
    }
    return [...close, { op: "row.appended", row }];
  },
  closeTextRow(this: ProjectionEngine, state: "complete" | "interrupted"): ConversationDelta[] {
    if (this.streamingTextRowId === null) return [];
    const row = this.findRow(this.streamingTextRowId);
    this.streamingTextRowId = null;
    if (row?.kind !== "assistantText") return [];
    return [{ op: "row.upserted", row: { ...row, state } }];
  },
  onAssistantFeedbackUpdated(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as AssistantFeedbackUpdatedPayload;
    const row = this.snapshot.rows.window.find(
      (candidate): candidate is AssistantTextRow =>
        candidate.kind === "assistantText" && candidate.entityId === payload.entityId,
    );
    if (!row) return [];
    if (payload.feedback === null) {
      if (row.feedback === undefined) return [];
      const { feedback: _removedFeedback, ...withoutFeedback } = row;
      return [{ op: "row.upserted", row: withoutFeedback }];
    }
    if (row.feedback === payload.feedback) return [];
    return [{ op: "row.upserted", row: { ...row, feedback: payload.feedback } }];
  },
  openReasoningRow(
    this: ProjectionEngine,
    event: SessionEvent,
    fact: CanonicalAssistantSegmentFact,
  ): ConversationDelta[] {
    const close = this.closeReasoningRow();
    const row: ReasoningRow = {
      ...this.rowBase(event, this.turnIdOf(event), fact.entityId),
      kind: "reasoning",
      // Bug 原因：canonical stream 已携带 assistant response 身份，但旧投影只在正文与工具行
      // 保存它，UI 因而无法把同 response 的 reasoning 确定性归入 CUA Group。
      ...(fact.stream.assistantResponseId
        ? { assistantResponseId: fact.stream.assistantResponseId }
        : {}),
      text: "",
      state: "streaming",
    };
    this.streamingReasoningRowId = row.rowId;
    this.entityIdByRowId.set(row.rowId, fact.entityId);
    return [...close, { op: "row.appended", row }];
  },
  closeReasoningRow(
    this: ProjectionEngine,
    state: "complete" | "interrupted" = "complete",
  ): ConversationDelta[] {
    if (this.streamingReasoningRowId === null) return [];
    const row = this.findRow(this.streamingReasoningRowId);
    this.streamingReasoningRowId = null;
    if (row?.kind !== "reasoning") return [];
    return [{ op: "row.upserted", row: { ...row, state } }];
  },
  closeStreamingRows(
    this: ProjectionEngine,
    state: "complete" | "interrupted",
  ): ConversationDelta[] {
    return [...this.closeTextRow(state), ...this.closeReasoningRow(state)];
  },
};
export type ProjectionStreamingMethods = typeof projectionStreaming;
