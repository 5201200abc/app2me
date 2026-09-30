import type { SessionEvent } from "@mycode/contracts";

import type {
  ConversationDelta,
  ConversationRow,
  ToolCallRow,
} from "@mycode/shared/mycode-protocol-v4";

import { type CanonicalOpenSegmentIdentity } from "./event-normalizer.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionRowIndex = {
  openSegmentIdentity(
    this: ProjectionEngine,
    rowId: number | null,
  ): CanonicalOpenSegmentIdentity | null {
    if (rowId === null) return null;
    const entityId = this.entityIdByRowId.get(rowId);
    if (!entityId) return null;
    return {
      entityId,
      transcriptMessageId: this.messageIdByRowId.get(rowId) ?? null,
    };
  },
  rowBase(
    this: ProjectionEngine,
    event: SessionEvent,
    turnId: string,
    entityId = String(event.id),
  ) {
    const rowId = this.nextRowId++;
    this.entityIdByRowId.set(rowId, entityId);
    return {
      rowId,
      turnId,
      entityId,
      productTurnId: turnId,
      visibility: "visible" as const,
      createdAt: this.ms(event),
      createdAtSeq: event.sequenceNumber,
    };
  },
  turnIdOf(this: ProjectionEngine, event: SessionEvent): string {
    const runtimeTurnId = String(event.turnId ?? this.currentTurnId ?? "turn-unknown");
    // queue drain 切轮后，同一 runtimeTurn 的后续事件行归入最新 productTurn。
    return this.productTurnIdByRuntimeTurnId.get(runtimeTurnId) ?? runtimeTurnId;
  },
  ms(this: ProjectionEngine, event: SessionEvent): number {
    return event.timestamp.getTime();
  },
  findRow(this: ProjectionEngine, rowId: number): ConversationRow | undefined {
    const index = this.rowIndexById.get(rowId);
    return index === undefined ? undefined : this.snapshot.rows.window[index];
  },
  updateRowIndexAfterImmutableApply(
    this: ProjectionEngine,
    previousRowsLength: number,
    deltas: readonly ConversationDelta[],
  ): void {
    if (deltas.some((delta) => delta.op === "row.removed")) {
      this.rowIndexById = new Map(
        this.snapshot.rows.window.map((row, index) => [row.rowId, index]),
      );
      return;
    }
    let nextIndex = previousRowsLength;
    for (const delta of deltas) {
      if (delta.op !== "row.appended") continue;
      this.rowIndexById.set(delta.row.rowId, nextIndex);
      nextIndex += 1;
    }
  },
  findToolRow(this: ProjectionEngine, toolCallId: string): ToolCallRow | undefined {
    const rowId = this.toolRowIdByCallId.get(toolCallId);
    if (rowId === undefined) return undefined;
    const row = this.findRow(rowId);
    return row?.kind === "toolCall" ? row : undefined;
  },
};
export type ProjectionRowIndexMethods = typeof projectionRowIndex;
