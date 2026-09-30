import { clearSettledOutputPreviews } from "./product-projection-bash-progress.js";
import type { SessionEvent } from "@mycode/contracts";
import { SessionEventType } from "@mycode/contracts";

import type { ConversationDelta } from "@mycode/shared/mycode-protocol-v4";

import {
  applyConversationDeltas,
  applyConversationDeltasMutable,
  createMutableConversationSnapshotAccumulator,
} from "@mycode/shared/mycode-protocol-v4";

import { normalizeConversationEvent } from "./event-normalizer.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionReplay = {
  /** 应用一个权威事件，返回该事件产生的 delta 序列（可能为空）。 */
  applyEvent(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    return this.applyEventInternal(event, true);
  },
  /**
   * 冷恢复批量路径只允许在尚未发布的候选 projection 上使用。begin 后 rows.window
   * 原地推进，避免每个事件复制增长数组；publisher 在完整校验通过前不会 adopt 候选。
   */
  beginHydrationReplay(this: ProjectionEngine): void {
    if (this.hydrationAccumulator) throw new Error("hydration replay already active");
    this.hydrationAccumulator = createMutableConversationSnapshotAccumulator(this.snapshot);
    this.snapshot = this.hydrationAccumulator.snapshot;
    this.rowIndexById = this.hydrationAccumulator.rowIndexById;
  },
  applyHydrationEvent(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    if (!this.hydrationAccumulator) throw new Error("hydration replay is not active");
    return this.applyEventInternal(event, false);
  },
  /**
   * 把批量期间延迟的 command actions 收敛到当前快照。actions 是同一 reducer 的派生
   * materialization，不单独递增 revision；触发它变化的结构/guard 事件已经记账。
   */
  completeHydrationReplay(this: ProjectionEngine): ConversationDelta[] {
    if (!this.hydrationAccumulator) throw new Error("hydration replay is not active");
    const deltas = this.materializeCommandRowActions([]);
    applyConversationDeltasMutable(this.hydrationAccumulator, deltas);
    this.hydrationAccumulator = null;
    return deltas;
  },
  applyEventInternal(
    this: ProjectionEngine,
    event: SessionEvent,
    materializeActions: boolean,
  ): ConversationDelta[] {
    if (event.type === SessionEventType.SubagentSpawned) {
      const childSessionId = this.stringPayload(
        event.payload as Record<string, unknown>,
        "childSessionId",
      );
      // live spawn 已经过 core persist-before-publish 闸门；若它是旧 ghost 的合法 resume，
      // 以新事件恢复资格。hydration 期间 seed 尚未建立排除集合，不会误放历史引用。
      if (childSessionId) this.invalidSubagentChildSessionIds.delete(childSessionId);
    }
    const runtimeTurnId = String(event.turnId ?? this.currentTurnId ?? "turn-unknown");
    const productTurnId =
      event.type === SessionEventType.TurnStarted
        ? undefined
        : (this.productTurnIdByRuntimeTurnId.get(runtimeTurnId) ?? runtimeTurnId);
    const reduced =
      event.type === SessionEventType.AssistantFeedbackUpdated
        ? this.onAssistantFeedbackUpdated(event)
        : (() => {
            const fact = normalizeConversationEvent(event, {
              productTurnId,
              openAssistantSegments: this.openAssistantSegments(),
            });
            this.normalizationDiagnostics.push(...fact.diagnostics);
            return this.reduce(fact);
          })();
    const subagentDeltas = this.shouldMaterializeSubagentProjection(reduced)
      ? this.materializeSubagentProjection(reduced)
      : [];
    const reducedWithSubagents = [...reduced, ...subagentDeltas];
    // row、命令 target 与 actions 必须属于同一个 materialization transaction。
    // 旧实现只维护 side-map/最新行判断，UI action 由别处推断，cold/tool-only/failed
    // 轮会出现“入口可见但 target 不可解析”，新目标出现后旧入口也不会撤销。
    const deltas = materializeActions
      ? [...reducedWithSubagents, ...this.materializeCommandRowActions(reducedWithSubagents)]
      : reducedWithSubagents;
    const finalDeltas = this.attachRevision(clearSettledOutputPreviews(deltas));
    if (this.hydrationAccumulator) {
      applyConversationDeltasMutable(this.hydrationAccumulator, finalDeltas);
      this.snapshot.seq = event.sequenceNumber;
    } else {
      const previousRowsLength = this.snapshot.rows.window.length;
      this.snapshot = {
        ...applyConversationDeltas(this.snapshot, finalDeltas),
        seq: event.sequenceNumber,
      };
      this.updateRowIndexAfterImmutableApply(previousRowsLength, finalDeltas);
    }
    this.updateToolIndexesAfterDeltas(finalDeltas);
    return finalDeltas;
  },
};
export type ProjectionReplayMethods = typeof projectionReplay;
