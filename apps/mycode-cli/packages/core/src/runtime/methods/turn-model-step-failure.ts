import { traceContextToLogContext, TurnMachineImpl } from "../deps.js";

import { createRuntimeAssistantEntry } from "../../agent/message-history.js";
import {
  projectExecutionErrorPayload,
  throwIfTurnAborted,
  isModelContextExceededError,
  isTurnCancellationError,
} from "../helpers/index.js";

import type { AgentRuntimeInternal } from "../internal.js";

import { persistCancelledStreamSnapshot } from "./cancelled-stream-persistence.js";
import {
  beginStartPlanBusyAdmissionRetryAttempt,
  createStartPlanBusyAutoRetryExhaustedError,
  emitStreamRecoveryRetryEvents,
  emitStreamRecoveryStarted,
  getStartPlanBusyAdmissionRetryDelayMs,
  isStartPlanBusyStreamRecoveryFailure,
} from "./streaming-recovery.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";
import { recordModelHistoryRound } from "./turn-loop-state.js";
import { recordMainTurnModelUsage } from "./turn-model-step-usage.js";

import {
  commitTurnRequestEntries,
  completeOutputTokenRecovery,
  hasAssistantReasoningContent,
} from "./turn-output-token-continuation.js";
import {
  type ModelStepResult,
  recoverModelStepAfterContextExceeded,
} from "./turn-model-step-model-step-result.js";
import type {
  ModelBackedTurnStepOptions,
  ModelBackedTurnStepContext,
  ModelStepFailureObservation,
} from "./turn-model-step-types.js";
export async function recoverFailedModelTurnStep(
  this: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  options: ModelBackedTurnStepOptions,
  step: ModelBackedTurnStepContext,
  error: unknown,
  observation: ModelStepFailureObservation,
): Promise<ModelStepResult> {
  const {
    assistantMessageId,
    model,
    modelStepIndex,
    modelStartedAt,
    assistantCreatedAt,
    executionModelSelection,
    modelTraceContext,
    streamingToolCoordinator,
    networkEventStartIndex,
  } = step;

  let finalError = error;
  await recordMainTurnModelUsage(this, state, {
    assistantMessageId,
    error: finalError,
    model,
    modelTraceContext,
    networkEventStartIndex,
    startedAt: modelStartedAt,
    status: state.turnAbortSignal.aborted ? "cancelled" : "error",
  });
  const failedRequestId =
    observation.latestFailedModelRequestId ?? observation.latestModelRequestId;
  const toolCallCountBeforeStreamRecovery = state.toolCallCount;
  if (
    await streamingToolCoordinator.recoverFromModelFailure(
      error,
      assistantCreatedAt,
      failedRequestId ? { failedRequestId } : undefined,
    )
  ) {
    if (state.toolCallCount > toolCallCountBeforeStreamRecovery) {
      completeOutputTokenRecovery(state.turnRequestState);
    }
    return "continue";
  }
  const admissionRetryDelayMs = getStartPlanBusyAdmissionRetryDelayMs({
    error: finalError,
    providerId: executionModelSelection.providerId,
    state,
    turnNumber: this.turnNumber,
  });
  if (!state.turnAbortSignal.aborted && admissionRetryDelayMs !== undefined) {
    // 第二轮及以后 Start Plan 可能在首 token 前被 admission 并发限制拒绝；
    // 这时没有文本或 tool anchor，旧 stream recovery 不会启动，必须关闭空 assistant 后短重试。
    const recoveryAttempt = beginStartPlanBusyAdmissionRetryAttempt(state);
    this.logger?.warn("Main turn retrying after Start Plan admission busy", {
      ...traceContextToLogContext(modelTraceContext),
      event: "model.main_turn.retry_start_plan_admission_busy",
      module: "core.runtime",
      retryDelayMs: admissionRetryDelayMs,
      retryNumber: recoveryAttempt.retryNumber,
      maxRetries: recoveryAttempt.maxRetries,
      status: "waiting",
    });
    await emitStreamRecoveryStarted(
      this,
      state,
      {
        assistantMessageId,
        ...(failedRequestId ? { failedRequestId } : {}),
        traceContext: modelTraceContext,
      },
      finalError,
      recoveryAttempt,
    );
    await this.persistAssistantMessage(
      assistantMessageId,
      state.userMessageId,
      assistantCreatedAt,
      {
        completed: Date.now(),
        finish: "start_plan_admission_retry_discarded",
      },
      modelTraceContext,
      model,
    );
    state.modelResponse = "";
    state.modelStepCount += 1;
    recordModelHistoryRound(state);
    state.turnMachine = new TurnMachineImpl(state.turnMachine.receiveModelResponse(""));
    state.turnMachine = new TurnMachineImpl(state.turnMachine.aggregateResults());
    await emitStreamRecoveryRetryEvents(
      this,
      state,
      {
        assistantMessageId,
        ...(failedRequestId ? { failedRequestId } : {}),
        traceContext: modelTraceContext,
      },
      {
        ...recoveryAttempt,
        discardedReasoningBytes: 0,
        discardedTextBytes: 0,
        reason: "no_tool_committed",
        toolCallIds: [],
      },
    );
    await streamingToolCoordinator.abandon("model_failed");
    await new Promise((resolve) => setTimeout(resolve, admissionRetryDelayMs));
    throwIfTurnAborted(state.turnAbortSignal);
    return "continue";
  }
  if (
    state.streamRecoveryRetryCount > 0 &&
    !state.turnAbortSignal.aborted &&
    isStartPlanBusyStreamRecoveryFailure(finalError)
  ) {
    // Start Plan 运行中断流会先走 core stream recovery；恢复次数耗尽后，
    // 继续抛原 provider 文案会和首轮繁忙失败无法区分，UI 也就不能展示“自动重试达到最大次数”。
    finalError = createStartPlanBusyAutoRetryExhaustedError(finalError);
  }
  await streamingToolCoordinator.abandon(
    state.turnAbortSignal.aborted ? "cancelled" : "model_failed",
  );
  if (state.turnAbortSignal.aborted && isTurnCancellationError(finalError, state.turnAbortSignal)) {
    await persistCancelledStreamSnapshot(this, {
      assistantCreatedAt,
      assistantMessageId,
      snapshot: observation.latestStreamSnapshot,
      traceContext: modelTraceContext,
    });
    const reasoning = observation.latestStreamSnapshot.reasoning.filter(
      hasAssistantReasoningContent,
    );
    if (observation.latestStreamSnapshot.text.length > 0 || reasoning.length > 0) {
      // 取消时 durable snapshot 已经持久化，但成功路径的 live history commit
      // 和 historyRoundCount 不会执行，导致当前进程与 cold resume 的 provider history 不一致。
      commitTurnRequestEntries(this, state.turnRequestState, [
        createRuntimeAssistantEntry(
          observation.latestStreamSnapshot.text,
          undefined,
          reasoning,
          state.model
            ? { providerId: state.model.providerId, modelId: state.model.modelId }
            : undefined,
        ),
      ]);
      recordModelHistoryRound(state);
    }
  }
  const finalErrorRecord =
    finalError && typeof finalError === "object"
      ? (finalError as Record<string, unknown>)
      : undefined;
  const persistedErrorCode =
    typeof finalErrorRecord?.code === "string" ? finalErrorRecord.code : undefined;
  const persistedErrorProjection = projectExecutionErrorPayload(finalError);
  const persistedTurnResult = isTurnCancellationError(finalError, state.turnAbortSignal)
    ? "cancelled"
    : undefined;
  await this.persistAssistantMessage(
    assistantMessageId,
    state.userMessageId,
    assistantCreatedAt,
    {
      completed: Date.now(),
      error: {
        name: finalError instanceof Error ? finalError.name : "UnknownError",
        data: {
          message: finalError instanceof Error ? finalError.message : String(finalError),
          ...(persistedErrorCode ? { code: persistedErrorCode } : {}),
          // live TurnError 有结构化归因，但 transcript 过去未持久化，冷恢复后会丢成 runtime。
          ...(persistedErrorProjection.attribution
            ? { attribution: persistedErrorProjection.attribution }
            : {}),
          // 用户 Stop 的模型中止过去只持久化通用 error name/message，
          // cold hydration 无法区分正常取消和真实 provider 失败，最终错误地生成 TurnError。
          ...(persistedTurnResult ? { turnResult: persistedTurnResult } : {}),
        },
      },
    },
    modelTraceContext,
    model,
  );
  if (
    isModelContextExceededError(finalError) &&
    (await recoverModelStepAfterContextExceeded.call(
      this,
      state,
      finalError,
      modelStepIndex,
      options.requestEntries,
    ))
  ) {
    return "continue";
  }
  throw finalError;
}
