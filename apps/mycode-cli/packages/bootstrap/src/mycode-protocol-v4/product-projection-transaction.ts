import type { SessionEvent } from "@mycode/contracts";

import type { ConversationDelta, ConversationSnapshot } from "@mycode/shared/mycode-protocol-v4";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionTransaction = {
  /**
   * 在独立候选投影上归约事件，校验通过后才原子提交。
   *
   * projection 超过 logical frame assembly 上限时，如果先修改当前实例再等
   * wire encoder 报错，权威内存态会永久停在“无法发 snapshot”的状态。候选实例同时
   * 隔离 snapshot 与 reducer 的各类 side-map；拒绝时当前实例完全不变，客户端仍可从
   * 最后一个可传输 snapshot 恢复。
   *
   * `accept` 同时拿到这条事件**实际产出**的 delta：有些事件类别可以只按 delta 的字节数给出
   * 一个可靠上界，不必把整份候选快照再序列化一遍（publisher 的 ingest 快路径）。传的是实际
   * 产出而不是预演，正是因为预演算不准——投影在 reducer 之上还叠了 subagent 镜像与命令
   * actions 的 materialization，少算一条就把 16MiB 闸门算松了。
   */
  applyEventAtomically(
    this: ProjectionEngine,
    event: SessionEvent,
    accept: (snapshot: ConversationSnapshot, deltas: readonly ConversationDelta[]) => boolean,
  ): ConversationDelta[] | null {
    const candidate = this.cloneProjection();
    const deltas = candidate.applyEvent(event);
    if (!accept(candidate.snapshot, deltas)) return null;
    this.adoptProjection(candidate);
    return deltas;
  },
  cloneProjection(this: ProjectionEngine): ProjectionEngine {
    const clone = Object.create(Object.getPrototypeOf(this)) as ProjectionEngine;
    clone.snapshot = this.snapshot;
    clone.rowIndexById = new Map(this.rowIndexById);
    clone.hydrationAccumulator = null;
    clone.nextRowId = this.nextRowId;
    clone.streamingTextRowId = this.streamingTextRowId;
    clone.streamingReasoningRowId = this.streamingReasoningRowId;
    clone.outputContinuationTextRowId = this.outputContinuationTextRowId;
    clone.toolRowIdByCallId = new Map(this.toolRowIdByCallId);
    // 实时发布逐事件走原子 clone；遗漏该侧表会让成功的 list_apps 快照在提交时丢失。
    clone.latestListAppsSnapshot = new Map(this.latestListAppsSnapshot);
    clone.openForegroundToolCallIds = new Set(this.openForegroundToolCallIds);
    clone.fileToolInputPreviewByCallId = new Map(
      [...this.fileToolInputPreviewByCallId].map(([toolCallId, state]) => [
        toolCallId,
        { ...state },
      ]),
    );
    clone.subagentRowIdByAgentId = new Map(this.subagentRowIdByAgentId);
    clone.hookRowIdByInvocationId = new Map(this.hookRowIdByInvocationId);
    clone.pendingSessionHookInvocations = new Map(
      [...this.pendingSessionHookInvocations].map(([invocationId, pending]) => [
        invocationId,
        {
          firstEvent: pending.firstEvent,
          content: {
            ...pending.content,
            executions: pending.content.executions.map((execution) => ({ ...execution })),
          },
        },
      ]),
    );
    clone.rewoundHookInvocationIds = new Set(this.rewoundHookInvocationIds);
    clone.invalidSubagentChildSessionIds = new Set(this.invalidSubagentChildSessionIds);
    clone.messageIdByRowId = new Map(this.messageIdByRowId);
    clone.outputContinuationRowIdByMessageId = new Map(this.outputContinuationRowIdByMessageId);
    clone.entityIdByRowId = new Map(this.entityIdByRowId);
    clone.editTargetByEntityId = new Map(this.editTargetByEntityId);
    clone.currentEditableEntityId = this.currentEditableEntityId;
    clone.stableCompactCoverageBoundaryRowId = this.stableCompactCoverageBoundaryRowId;
    clone.turnHeaderRowIdByTurnId = new Map(this.turnHeaderRowIdByTurnId);
    clone.compactMarkerRowIdByOperationId = new Map(this.compactMarkerRowIdByOperationId);
    clone.goalVerifyMarkerRowIdByLifecycleKey = new Map(this.goalVerifyMarkerRowIdByLifecycleKey);
    clone.productTurnIdByRuntimeTurnId = new Map(this.productTurnIdByRuntimeTurnId);
    clone.runtimeTurnIdByProductTurnId = new Map(this.runtimeTurnIdByProductTurnId);
    clone.productTurnSplitOrdinalByRuntimeTurnId = new Map(
      this.productTurnSplitOrdinalByRuntimeTurnId,
    );
    clone.currentProductTurnStartedAtMs = this.currentProductTurnStartedAtMs;
    clone.deliveryByPendingInputId = new Map(this.deliveryByPendingInputId);
    clone.currentTurnId = this.currentTurnId;
    clone.currentTurnStartedModelOnly = this.currentTurnStartedModelOnly;
    clone.contextWindowState = { ...this.contextWindowState };
    clone.lastTurnModel = { ...this.lastTurnModel };
    clone.configModelTouchedByEvent = this.configModelTouchedByEvent;
    clone.configThoughtLevelsTouchedByEvent = this.configThoughtLevelsTouchedByEvent;
    clone.configModeTouchedByEvent = this.configModeTouchedByEvent;
    clone.droppedContentStreamEventCount = this.droppedContentStreamEventCount;
    clone.normalizationDiagnostics = [...this.normalizationDiagnostics];
    return clone;
  },
  adoptProjection(this: ProjectionEngine, candidate: ProjectionEngine): void {
    this.snapshot = candidate.snapshot;
    this.rowIndexById = candidate.rowIndexById;
    this.hydrationAccumulator = null;
    this.nextRowId = candidate.nextRowId;
    this.streamingTextRowId = candidate.streamingTextRowId;
    this.streamingReasoningRowId = candidate.streamingReasoningRowId;
    this.outputContinuationTextRowId = candidate.outputContinuationTextRowId;
    this.toolRowIdByCallId = candidate.toolRowIdByCallId;
    this.latestListAppsSnapshot = candidate.latestListAppsSnapshot;
    this.openForegroundToolCallIds = candidate.openForegroundToolCallIds;
    this.fileToolInputPreviewByCallId = candidate.fileToolInputPreviewByCallId;
    this.subagentRowIdByAgentId = candidate.subagentRowIdByAgentId;
    this.hookRowIdByInvocationId = candidate.hookRowIdByInvocationId;
    this.pendingSessionHookInvocations = candidate.pendingSessionHookInvocations;
    this.rewoundHookInvocationIds = candidate.rewoundHookInvocationIds;
    this.invalidSubagentChildSessionIds = candidate.invalidSubagentChildSessionIds;
    this.messageIdByRowId = candidate.messageIdByRowId;
    this.outputContinuationRowIdByMessageId = candidate.outputContinuationRowIdByMessageId;
    this.entityIdByRowId = candidate.entityIdByRowId;
    this.editTargetByEntityId = candidate.editTargetByEntityId;
    this.currentEditableEntityId = candidate.currentEditableEntityId;
    this.stableCompactCoverageBoundaryRowId = candidate.stableCompactCoverageBoundaryRowId;
    this.turnHeaderRowIdByTurnId = candidate.turnHeaderRowIdByTurnId;
    this.compactMarkerRowIdByOperationId = candidate.compactMarkerRowIdByOperationId;
    this.goalVerifyMarkerRowIdByLifecycleKey = candidate.goalVerifyMarkerRowIdByLifecycleKey;
    this.productTurnIdByRuntimeTurnId = candidate.productTurnIdByRuntimeTurnId;
    this.runtimeTurnIdByProductTurnId = candidate.runtimeTurnIdByProductTurnId;
    this.productTurnSplitOrdinalByRuntimeTurnId = candidate.productTurnSplitOrdinalByRuntimeTurnId;
    this.currentProductTurnStartedAtMs = candidate.currentProductTurnStartedAtMs;
    this.deliveryByPendingInputId = candidate.deliveryByPendingInputId;
    this.currentTurnId = candidate.currentTurnId;
    this.currentTurnStartedModelOnly = candidate.currentTurnStartedModelOnly;
    this.contextWindowState = candidate.contextWindowState;
    this.lastTurnModel = candidate.lastTurnModel;
    this.configModelTouchedByEvent = candidate.configModelTouchedByEvent;
    this.configThoughtLevelsTouchedByEvent = candidate.configThoughtLevelsTouchedByEvent;
    this.configModeTouchedByEvent = candidate.configModeTouchedByEvent;
    this.droppedContentStreamEventCount = candidate.droppedContentStreamEventCount;
    this.normalizationDiagnostics = candidate.normalizationDiagnostics;
  },
};
export type ProjectionTransactionMethods = typeof projectionTransaction;
