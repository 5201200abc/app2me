import type { SessionEvent, SessionForkedPayload } from "@mycode/contracts";

import type {
  ConversationDelta,
  ConversationSnapshot,
  GoalState,
  SessionControl,
  StatePatch,
  TimelineMarkerRow,
} from "@mycode/shared/mycode-protocol-v4";

import { computeAvailability, computeInputRouting } from "./projection-state.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionControlState = {
  // ── fork marker（forkAssistant 命令效果）──

  onSessionForked(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as SessionForkedPayload;
    const isParent = String(payload.originalSessionId) === this.snapshot.sessionId;
    if (isParent) {
      // 父时间线不显示 forkCreated——fork 关系只在 sessions
      // 树/列表体现。旧实现以 nextRowId-1 近似锚点产 row，且 UI 渲染为 null
      // （隐形行污染 turn 分组）；child 首部 forkNotice 保留不变。
      return [];
    }
    // child 首部 forkNotice（forkTimelineIsBoundary）：事件 payload 不携带
    // parent 侧 rowId，先以 0 占位；transcript 锚点 → rowId 映射随传输外壳补齐。
    const row: TimelineMarkerRow = {
      ...this.rowBase(
        event,
        this.turnIdOf(event),
        `fork:${String(payload.originalSessionId)}:${String(payload.targetMessageId ?? "unknown")}`,
      ),
      kind: "timelineMarker",
      lane: "turnTailBoundary",
      marker: {
        type: "forkNotice",
        parentSessionId: String(payload.originalSessionId),
        parentRowId: 0,
      },
    };
    return [{ op: "row.appended", row }];
  },
  // ── 内部工具 ──

  // goal 传 undefined = 不动 goal；传 null/对象 = 随本 patch 一并替换（availability 同源派生）。
  // queue 传 undefined = 不动 queue；held 派生（heldQueueInputRequiresChoice）依赖
  // queue.items.length + autoDrain，所以任何 control/goal/queue 变化都从同一处重算 A 区。
  controlPatch(
    this: ProjectionEngine,
    control: Partial<SessionControl>,
    goal?: GoalState | null,
    queue?: ConversationSnapshot["queue"],
  ): StatePatch {
    const next: SessionControl = { ...this.snapshot.control, ...control };
    const nextGoal = goal === undefined ? this.snapshot.goal : goal;
    const nextQueue = queue ?? this.snapshot.queue;
    const context = {
      phase: next.phase,
      goalStatus: nextGoal?.status ?? null,
      // compacting 不是独立 phase（封闭枚举），从 activeWorks 派生。
      compacting: next.activeWorks.some((work) => work.kind === "compact"),
      goalVerifying: next.activeWorks.some((work) => work.kind === "goalVerifier"),
      queueLength: nextQueue.items.length,
      autoDrain: nextQueue.autoDrain,
    };
    return {
      control: next,
      ...(goal === undefined ? {} : { goal }),
      ...(queue === undefined ? {} : { queue }),
      availability: computeAvailability(context),
      inputRouting: computeInputRouting(context, this.snapshot.config.followupMode),
    };
  },
  // goal 单独变化时的 patch（availability 与 goal 同源，phase/activeWorks 不变）。
  goalPatch(this: ProjectionEngine, goal: GoalState | null): StatePatch {
    return {
      goal,
      availability: computeAvailability(this.deriveContext({ goal })),
    };
  },
  // queue 单独变化时的 patch：queue 长度/autoDrain 影响 held 派生 → 同步重算 A 区。
  queuePatch(this: ProjectionEngine, queue: ConversationSnapshot["queue"]): StatePatch {
    const context = this.deriveContext({ queue });
    return {
      queue,
      availability: computeAvailability(context),
      inputRouting: computeInputRouting(context, this.snapshot.config.followupMode),
    };
  },
  deriveContext(
    this: ProjectionEngine,
    overrides: {
      goal?: GoalState | null;
      queue?: ConversationSnapshot["queue"];
    },
  ) {
    const goal = overrides.goal === undefined ? this.snapshot.goal : overrides.goal;
    const queue = overrides.queue ?? this.snapshot.queue;
    return {
      phase: this.snapshot.control.phase,
      goalStatus: goal?.status ?? null,
      compacting: this.snapshot.control.activeWorks.some((work) => work.kind === "compact"),
      goalVerifying: this.snapshot.control.activeWorks.some((work) => work.kind === "goalVerifier"),
      queueLength: queue.items.length,
      autoDrain: queue.autoDrain,
    };
  },
};
export type ProjectionControlStateMethods = typeof projectionControlState;
