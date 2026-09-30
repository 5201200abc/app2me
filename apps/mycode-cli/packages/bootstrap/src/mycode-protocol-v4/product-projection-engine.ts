import { projectionSeeds, type ProjectionSeedsMethods } from "./product-projection-seeds.js";
import { projectionQueries, type ProjectionQueriesMethods } from "./product-projection-queries.js";
import { projectionReplay, type ProjectionReplayMethods } from "./product-projection-replay.js";
import {
  projectionTransaction,
  type ProjectionTransactionMethods,
} from "./product-projection-transaction.js";
import {
  projectionRowActions,
  type ProjectionRowActionsMethods,
} from "./product-projection-row-actions.js";
import {
  projectionDispatch,
  type ProjectionDispatchMethods,
} from "./product-projection-dispatch.js";
import { projectionSession, type ProjectionSessionMethods } from "./product-projection-session.js";
import { projectionHooks, type ProjectionHooksMethods } from "./product-projection-hooks.js";
import { projectionRewind, type ProjectionRewindMethods } from "./product-projection-rewind.js";
import {
  projectionSessionLifecycle,
  type ProjectionSessionLifecycleMethods,
} from "./product-projection-session-lifecycle.js";
import {
  projectionTurnStart,
  type ProjectionTurnStartMethods,
} from "./product-projection-turn-start.js";
import {
  projectionTurnCompletion,
  type ProjectionTurnCompletionMethods,
} from "./product-projection-turn-completion.js";
import {
  projectionNetworkStatus,
  type ProjectionNetworkStatusMethods,
} from "./product-projection-network-status.js";
import {
  projectionStreaming,
  type ProjectionStreamingMethods,
} from "./product-projection-streaming.js";
import {
  projectionToolRows,
  type ProjectionToolRowsMethods,
} from "./product-projection-tool-rows.js";
import {
  projectionToolEvents,
  type ProjectionToolEventsMethods,
} from "./product-projection-tool-events.js";
import {
  projectionPermissions,
  type ProjectionPermissionsMethods,
} from "./product-projection-permissions.js";
import {
  projectionHookReview,
  type ProjectionHookReviewMethods,
} from "./product-projection-hook-review.js";
import {
  projectionQueueAdmission,
  type ProjectionQueueAdmissionMethods,
} from "./product-projection-queue-admission.js";
import {
  projectionQueueDrain,
  type ProjectionQueueDrainMethods,
} from "./product-projection-queue-drain.js";
import { projectionMode, type ProjectionModeMethods } from "./product-projection-mode.js";
import {
  projectionSubagentProjection,
  type ProjectionSubagentProjectionMethods,
} from "./product-projection-subagent-projection.js";
import {
  projectionSubagentEvents,
  type ProjectionSubagentEventsMethods,
} from "./product-projection-subagent-events.js";
import {
  projectionBackgroundWork,
  type ProjectionBackgroundWorkMethods,
} from "./product-projection-background-work.js";
import {
  projectionQueueRemoval,
  type ProjectionQueueRemovalMethods,
} from "./product-projection-queue-removal.js";
import { projectionModel, type ProjectionModelMethods } from "./product-projection-model.js";
import {
  projectionCompaction,
  type ProjectionCompactionMethods,
} from "./product-projection-compaction.js";
import {
  projectionGoalStatus,
  type ProjectionGoalStatusMethods,
} from "./product-projection-goal-status.js";
import {
  projectionGoalVerification,
  type ProjectionGoalVerificationMethods,
} from "./product-projection-goal-verification.js";
import {
  projectionControlState,
  type ProjectionControlStateMethods,
} from "./product-projection-control-state.js";
import {
  projectionTurnRows,
  type ProjectionTurnRowsMethods,
} from "./product-projection-turn-rows.js";
import {
  projectionRowIndex,
  type ProjectionRowIndexMethods,
} from "./product-projection-row-index.js";
import {
  projectionSubagentIndex,
  type ProjectionSubagentIndexMethods,
} from "./product-projection-subagent-index.js";
import { ProjectionEngineState } from "./product-projection-engine-state.js";

export class ProjectionEngine extends ProjectionEngineState {}
export interface ProjectionEngine
  extends
    ProjectionSeedsMethods,
    ProjectionQueriesMethods,
    ProjectionReplayMethods,
    ProjectionTransactionMethods,
    ProjectionRowActionsMethods,
    ProjectionDispatchMethods,
    ProjectionSessionMethods,
    ProjectionHooksMethods,
    ProjectionRewindMethods,
    ProjectionSessionLifecycleMethods,
    ProjectionTurnStartMethods,
    ProjectionTurnCompletionMethods,
    ProjectionNetworkStatusMethods,
    ProjectionStreamingMethods,
    ProjectionToolRowsMethods,
    ProjectionToolEventsMethods,
    ProjectionPermissionsMethods,
    ProjectionHookReviewMethods,
    ProjectionQueueAdmissionMethods,
    ProjectionQueueDrainMethods,
    ProjectionModeMethods,
    ProjectionSubagentProjectionMethods,
    ProjectionSubagentEventsMethods,
    ProjectionBackgroundWorkMethods,
    ProjectionQueueRemovalMethods,
    ProjectionModelMethods,
    ProjectionCompactionMethods,
    ProjectionGoalStatusMethods,
    ProjectionGoalVerificationMethods,
    ProjectionControlStateMethods,
    ProjectionTurnRowsMethods,
    ProjectionRowIndexMethods,
    ProjectionSubagentIndexMethods {}

// 按职责装配原型方法；保持原类的非枚举方法与共享 this，不建立第二份投影状态。
for (const methods of [
  projectionSeeds,
  projectionQueries,
  projectionReplay,
  projectionTransaction,
  projectionRowActions,
  projectionDispatch,
  projectionSession,
  projectionHooks,
  projectionRewind,
  projectionSessionLifecycle,
  projectionTurnStart,
  projectionTurnCompletion,
  projectionNetworkStatus,
  projectionStreaming,
  projectionToolRows,
  projectionToolEvents,
  projectionPermissions,
  projectionHookReview,
  projectionQueueAdmission,
  projectionQueueDrain,
  projectionMode,
  projectionSubagentProjection,
  projectionSubagentEvents,
  projectionBackgroundWork,
  projectionQueueRemoval,
  projectionModel,
  projectionCompaction,
  projectionGoalStatus,
  projectionGoalVerification,
  projectionControlState,
  projectionTurnRows,
  projectionRowIndex,
  projectionSubagentIndex,
]) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
    Object.defineProperty(ProjectionEngine.prototype, name, { ...descriptor, enumerable: false });
  }
}
