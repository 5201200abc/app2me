import type { SessionEvent } from "@mycode/contracts";

import type {
  AssistantTextRow,
  ConversationDelta,
  TurnHeaderRow,
  TurnWorkSegment,
} from "@mycode/shared/mycode-protocol-v4";

import { type CanonicalOpenSegmentIdentity } from "./event-normalizer.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionTurnRows = {
  upsertTurnHeader(
    this: ProjectionEngine,
    event: SessionEvent,
    state: "completedSuccess" | "completedInterrupted" | "failed",
    activeMs?: number,
    historyRoundCount?: number,
  ): ConversationDelta[] {
    const row = this.turnHeaderForEvent(event);
    if (!row) return [];
    const endedAt = this.ms(event);
    return [
      {
        op: "row.upserted",
        row: {
          ...row,
          state,
          endedAt,
          ...(activeMs !== undefined ? { activeMs } : {}),
          ...(historyRoundCount !== undefined ? { historyRoundCount } : {}),
          ...(row.workSegments
            ? {
                workSegments: this.completeWorkSegments(row.workSegments, endedAt),
              }
            : {}),
        },
      },
    ];
  },
  openGuidedWorkSegment(
    this: ProjectionEngine,
    event: SessionEvent,
    triggerEntityId: string,
  ): ConversationDelta[] {
    const row = this.turnHeaderForEvent(event);
    if (!row || row.executionKind === "controlOnly") return [];
    const startedAt = this.ms(event);
    const existingSegments: TurnWorkSegment[] = row.workSegments ?? [
      {
        segmentId: `${row.turnId}:initial`,
        startedAt: row.startedAt,
      },
    ];
    // 旧 UI 为整个 product turn 只维护一个折叠状态，accepted guide 只能
    // 作为普通行插入，无法恢复独立工作区。分段边界必须由 CLI 记录，React 不能按邻接行猜。
    const workSegments = [
      ...this.completeWorkSegments(existingSegments, startedAt),
      {
        segmentId: triggerEntityId,
        triggerEntityId,
        startedAt,
      },
    ];
    return [{ op: "row.upserted", row: { ...row, workSegments } }];
  },
  completeWorkSegments(
    this: ProjectionEngine,
    segments: readonly TurnWorkSegment[],
    endedAt: number,
  ): TurnWorkSegment[] {
    return segments.map((segment, index) =>
      index === segments.length - 1 && segment.endedAt === undefined
        ? {
            ...segment,
            endedAt,
            activeMs: Math.max(0, endedAt - segment.startedAt),
          }
        : segment,
    );
  },
  turnHeaderForEvent(this: ProjectionEngine, event: SessionEvent): TurnHeaderRow | undefined {
    const rowId = this.turnHeaderRowIdByTurnId.get(this.turnIdOf(event));
    if (rowId === undefined) return undefined;
    const row = this.findRow(rowId);
    return row?.kind === "turnHeader" ? row : undefined;
  },
  markStableForkAssistant(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const turnId = this.turnIdOf(event);
    const rows = this.snapshot.rows.window;
    const headerRowId = this.turnHeaderRowIdByTurnId.get(turnId);
    const headerIndex = headerRowId === undefined ? undefined : this.rowIndexById.get(headerRowId);
    const startIndex = headerIndex === undefined ? 0 : headerIndex + 1;
    let row: AssistantTextRow | undefined;
    // 性能问题根因：旧实现每个成功 turn 都复制并反转完整历史 rows，冷恢复会累积为
    // 近似 O(turns * rows) 的分配与扫描。当前 turn 的行只会出现在自身 header 之后。
    for (let index = rows.length - 1; index >= startIndex; index -= 1) {
      const candidate = rows[index];
      if (candidate?.kind !== "assistantText" || candidate.turnId !== turnId) continue;
      row = candidate;
      break;
    }
    if (!row || !this.messageIdByRowId.has(row.rowId)) return [];
    return [
      {
        op: "row.upserted",
        row: {
          ...row,
          state: "complete",
          actions: { ...row.actions, canFork: true },
        },
      },
    ];
  },
  isRunning(this: ProjectionEngine): boolean {
    const phase = this.snapshot.control.phase;
    return phase === "running" || phase === "prewarming";
  },
  isMirroredSubagentToolEvent(this: ProjectionEngine, event: SessionEvent): boolean {
    const payload = event.payload as unknown as Record<string, unknown>;
    // Bug 原因：child tool lifecycle 会镜像到父 runtime，但它不是父 session 的工具事实。
    // V4 过去把 mirror 当普通 ToolCallRow，导致 main timeline 展示 child 的 Read/Bash，
    // 并让 replayable snapshot 同样带上脏 row。完整工具历史只应由 child topic 物化。
    return payload.source === "subagent";
  },
  openAssistantSegments(
    this: ProjectionEngine,
  ): Partial<Record<"text" | "reasoning", CanonicalOpenSegmentIdentity>> {
    const segments: Partial<Record<"text" | "reasoning", CanonicalOpenSegmentIdentity>> = {};
    const text = this.openSegmentIdentity(this.streamingTextRowId);
    const reasoning = this.openSegmentIdentity(this.streamingReasoningRowId);
    if (text) segments.text = text;
    if (reasoning) segments.reasoning = reasoning;
    return segments;
  },
};
export type ProjectionTurnRowsMethods = typeof projectionTurnRows;
