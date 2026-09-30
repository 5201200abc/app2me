import type { CompactLifecyclePayload, SessionEvent } from "@mycode/contracts";

import type {
  ConversationDelta,
  TimelineMarkerPayload,
  TimelineMarkerRow,
} from "@mycode/shared/mycode-protocol-v4";

import { mapCompactMarkerOrigin, mapCompactMarkerStatus } from "./projection-rows.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionCompaction = {
  // ── compact marker（compact 命令效果）──
  // 同一 operationId 全生命周期占同一 marker row：running → success/failed/noop/cancelled。
  // 归属：marker 落在事件到达时的行尾，客户端零归属逻辑。

  onCompactLifecycle(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as CompactLifecyclePayload & {
      anchorMessageId?: string;
      tailStartMessageId?: string;
    };
    const existingRowId = this.compactMarkerRowIdByOperationId.get(payload.operationId);
    const existingRow = existingRowId !== undefined ? this.findRow(existingRowId) : undefined;
    const prev =
      existingRow?.kind === "timelineMarker" && existingRow.marker.type === "compact"
        ? existingRow.marker
        : undefined;

    const status = mapCompactMarkerStatus(payload.status);
    if (status === "success") {
      const coverageMessageId = payload.tailStartMessageId ?? payload.anchorMessageId;
      const coverageRowId = coverageMessageId ? this.rowIdForMessageId(coverageMessageId) : null;
      if (coverageRowId !== null) {
        this.stableCompactCoverageBoundaryRowId = Math.max(
          this.stableCompactCoverageBoundaryRowId ?? 0,
          coverageRowId,
        );
        for (const [rowId, entityId] of this.entityIdByRowId) {
          if (rowId > this.stableCompactCoverageBoundaryRowId) continue;
          const target = this.editTargetByEntityId.get(entityId);
          if (target && !target.coveredByStableCompact) {
            this.editTargetByEntityId.set(entityId, {
              ...target,
              coveredByStableCompact: true,
            });
          }
        }
      }
    }
    const tokensAfter =
      payload.truePostCompactTokenCount ?? payload.postCompactTokenCount ?? prev?.tokensAfter;
    const marker: TimelineMarkerPayload = {
      type: "compact",
      origin: prev?.origin ?? mapCompactMarkerOrigin(payload.trigger),
      status,
      // 终态事件才带 token 计数；upsert 时保留已知值（retry 不清零）。
      ...(payload.preCompactTokenCount !== undefined || prev?.tokensBefore !== undefined
        ? { tokensBefore: payload.preCompactTokenCount ?? prev?.tokensBefore }
        : {}),
      ...(tokensAfter !== undefined ? { tokensAfter } : {}),
      // summary 全文按 ref 拉（同 toolOutput/get）；以 summaryMessageId 占位。
      ...(payload.summaryMessageId !== undefined || prev?.summaryRef
        ? {
            summaryRef:
              payload.summaryMessageId !== undefined
                ? String(payload.summaryMessageId)
                : prev?.summaryRef,
          }
        : {}),
    };

    const deltas: ConversationDelta[] = [];
    if (existingRow?.kind === "timelineMarker") {
      deltas.push({
        op: "row.upserted",
        row: {
          ...existingRow,
          marker,
          ...(payload.sourceCommandId ? { sourceCommandId: payload.sourceCommandId } : {}),
        },
      });
    } else {
      const row: TimelineMarkerRow = {
        ...this.rowBase(event, this.turnIdOf(event), String(payload.operationId)),
        kind: "timelineMarker",
        lane: "assistantWork",
        marker,
        ...(payload.sourceCommandId ? { sourceCommandId: payload.sourceCommandId } : {}),
      };
      this.compactMarkerRowIdByOperationId.set(payload.operationId, row.rowId);
      deltas.push({ op: "row.appended", row });
    }

    // compacting 进出 activeWorks（guard 同源派生：compactOperationLock /
    // compactingAcceptsFutureInput 由此驱动，与 formal-proof evaluateCompacting 对齐）。
    const otherWorks = this.snapshot.control.activeWorks.filter((work) => work.kind !== "compact");
    if (status === "running") {
      deltas.push({
        op: "state.updated",
        patch: this.controlPatch({
          activeWorks: [...otherWorks, { kind: "compact", startedAt: this.ms(event) }],
          canStop: true,
          stopState: "stoppable",
          stopTargetKind: otherWorks.length > 0 ? "mixed" : "compact",
        }),
      });
    } else {
      deltas.push({
        op: "state.updated",
        patch: this.controlPatch({
          activeWorks: otherWorks,
          ...(otherWorks.length === 0
            ? {
                canStop: false,
                stopState: "idle" as const,
                stopTargetKind: "unknown" as const,
              }
            : {}),
        }),
      });
    }

    // compact 成功 → context 水位立即回落（usage.contextWindow 更新）。
    if (status === "success" && tokensAfter !== undefined) {
      this.contextWindowState.usedTokens = tokensAfter;
      const maxTokens =
        this.snapshot.usage.contextWindow?.maxTokens ?? this.contextWindowState.maxTokens;
      deltas.push({
        op: "state.updated",
        patch: {
          usage: {
            ...this.snapshot.usage,
            contextWindow:
              maxTokens === null
                ? null
                : {
                    usedTokens: tokensAfter,
                    maxTokens,
                    autoCompactThresholdTokens:
                      this.snapshot.usage.contextWindow?.autoCompactThresholdTokens ?? null,
                  },
          },
        },
      });
    }
    return deltas;
  },
};
export type ProjectionCompactionMethods = typeof projectionCompaction;
