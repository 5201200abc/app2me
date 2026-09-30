import {
  CoreErrorType,
  SessionEventType,
  createModelUsageSummaryFromEvents,
  traceContextToLogContext,
} from "../deps.js";
import type { SessionGoal } from "../deps.js";
import { createTurnFailureError, appendTurnOutcomeEvent } from "../helpers/index.js";
import type { TurnResult } from "../types.js";

import type { AgentRuntimeInternal } from "../internal.js";

import { maybeStartDeferredSessionTitleGeneration } from "./session-title.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";

import { recordTurnUsageFact } from "./usage-observability.js";
import { persistStableForkCompletionBoundary } from "./stable-fork-boundary.js";

import { scheduleProjectMemoryExtraction } from "../helpers/project-memory-extraction.js";
import { appendBrowserTurnScreenshot } from "./browser-turn-screenshot.js";

import type { TurnCommandPhaseContext, TurnOutcomeState } from "./turn-command-context.js";
export async function completeRegularTurn(
  this: AgentRuntimeInternal,
  context: TurnCommandPhaseContext,
  outcome: Pick<TurnOutcomeState, "startedTarget" | "turnMachine" | "userMessageId"> & {
    loopState: RegularTurnLoopState;
    shouldRetryTitleGenerationAfterTurn: boolean;
  },
): Promise<TurnResult> {
  const {
    displayInput,
    options,
    turnId,
    traceId,
    turnTraceContext,
    turnStartedAtMs,
    targetRunInputID,
    events,
  } = context;
  const {
    loopState,
    startedTarget,
    turnMachine,
    userMessageId,
    shouldRetryTitleGenerationAfterTurn,
  } = outcome;

  const turnUsage = createModelUsageSummaryFromEvents(events);
  // goal usage/active-run 先结算，再固定 exact goal/verifier boundary；只有两者都
  // 已持久化，TurnComplete 才能让 projection/UI 开放最终 assistant fork。
  await this.accountTargetTurnCompletion({
    inputID: targetRunInputID,
    startedAtMs: turnStartedAtMs,
    startedTarget,
    traceContext: turnTraceContext,
    usage: turnUsage,
  });
  if (loopState.stableProductStartMessageId && loopState.stableBoundaryAssistantMessageId) {
    await persistStableForkCompletionBoundary(this, {
      boundaryMessageId: loopState.stableBoundaryAssistantMessageId,
      startMessageId: loopState.stableProductStartMessageId,
      historyRoundCount: loopState.historyRoundCount,
      traceContext: turnTraceContext,
    });
  }
  if (loopState.stableBoundaryAssistantMessageId) {
    await appendBrowserTurnScreenshot(this, loopState, loopState.stableBoundaryAssistantMessageId);
  }
  const completeEvent = this.createEvent(
    SessionEventType.TurnComplete,
    {
      response: loopState.modelResponse,
      tokenCount: loopState.tokenCount,
      usage: turnUsage,
      toolCallCount: loopState.toolCallCount,
      historyRoundCount: loopState.historyRoundCount,
      duration: Date.now() - turnMachine.state.startedAt.getTime(),
      resultType: "success",
      ...(loopState.backgroundSubagentResultConsumed
        ? { backgroundSubagentResultConsumed: true }
        : {}),
      ...(loopState.workflowResultConsumed ? { workflowResultConsumed: true } : {}),
      cacheStats: this.messageHistory.getCacheStats(),
      inputId: options?.inputId,
    },
    turnTraceContext,
  );
  await this.appendEvent(completeEvent, turnTraceContext);
  events.push(completeEvent);
  await recordTurnUsageFact(this, {
    completedAt: Date.now(),
    events,
    startedAt: turnStartedAtMs,
    status: "completed",
    traceContext: turnTraceContext,
    turnId,
    userMessageId,
  });
  if (shouldRetryTitleGenerationAfterTurn && userMessageId) {
    // 需要请求前刷新 provider runtime headers 的模型
    // 若在主 turn 前生成标题，会先占用鉴权刷新窗口，导致真正的用户消息失败。
    maybeStartDeferredSessionTitleGeneration.call(
      this,
      displayInput,
      userMessageId,
      turnTraceContext,
    );
  }
  this.turnNumber++;

  const projection = await this.rebuildProjection();
  this.logger?.info("Turn completed", {
    ...traceContextToLogContext(turnTraceContext),
    durationMs: Date.now() - turnMachine.state.startedAt.getTime(),
    event: "turn.completed",
    module: "core.runtime",
    status: "completed",
    toolCallCount: loopState.toolCallCount,
  });
  // 单轮执行策略只抑制本次成功 Turn 的后台提取，不修改 Session Memory 配置。
  if (options?.modelExecution?.memoryExtraction !== "skip") {
    scheduleProjectMemoryExtraction(this, {
      model: loopState.model,
      traceContext: turnTraceContext,
    });
  }

  const result: TurnResult = {
    response: loopState.modelResponse,
    turnId,
    traceId,
    usage: turnUsage,
    events,
    projection,
  };
  return result;
}

export async function failRegularTurn(
  this: AgentRuntimeInternal,
  context: TurnCommandPhaseContext,
  outcome: TurnOutcomeState,
  error: unknown,
  onTargetFinished: (target: SessionGoal | null) => void,
): Promise<never> {
  const {
    options,
    turnId,
    turnTraceContext,
    turnAbortSignal,
    turnStartedAtMs,
    targetRunInputID,
    events,
  } = context;
  const { activeTurn, loopState, startedTarget, turnMachine, userMessageId } = outcome;

  const coreError = createTurnFailureError(error, turnAbortSignal, "Turn execution failed");

  const preserveQueueAutoDrainOnCancel =
    coreError.type === CoreErrorType.TurnCancelled &&
    this.activeForegroundExecution?.preserveQueueAutoDrainOnCancel === true;

  const finishedTarget = await this.finishTargetTurnAccounting({
    endedAtMs: Date.now(),
    inputID: targetRunInputID,
    startedTarget,
    status: coreError.type === CoreErrorType.TurnCancelled ? "paused" : undefined,
    traceContext: turnTraceContext,
  });

  if (finishedTarget?.targetID === startedTarget?.targetID) {
    onTargetFinished(finishedTarget);
  }

  if (coreError.type === CoreErrorType.TurnCancelled) {
    await this.pauseActiveTargetForCancellation(turnTraceContext);
    if (activeTurn) {
      await this.fallbackPendingGuidesToQueue({
        activeTurn,
        events,
        reasonCode: "guide.turnInterrupted",
        traceContext: turnTraceContext,
      });
    }
  }

  // 普通 TurnError 只结束当前 turn，不撤销已经 accepted 的 future input。
  // V4 TurnError 投影将队列切成 error-paused，runtime 同步关闭行内 drain，
  // 保留排队输入，等待用户显式继续。
  if (activeTurn && coreError.type !== CoreErrorType.TurnCancelled) {
    const pendingInputs = (await this.rebuildProjection()).pendingSteerInputs;
    if (pendingInputs.length > 0) {
      this.queueAutoDrain = false;
      this.queueExternalDrainActive = false;
    }
  } else if (
    activeTurn &&
    coreError.type === CoreErrorType.TurnCancelled &&
    !preserveQueueAutoDrainOnCancel &&
    activeTurn.pendingInputs.length > 0
  ) {
    // runtime 授权位与投影同步：投影在 TurnComplete(cancelled)+queue>0 时把
    // queue.autoDrain 置 false（held），runtime 的 drain 门也必须同步翻转，
    // 否则 held 期间新起的 turn 会把后续入队项 drain 掉，与投影语义分叉。
    this.queueAutoDrain = false;
    this.queueExternalDrainActive = false;
  }

  // background wake 可能在 loopState 初始化前取消；此时仍要保留已 dequeue 的结果事实。
  const backgroundSubagentResultConsumed =
    options?.backgroundSubagentResultConsumed === true ||
    loopState?.backgroundSubagentResultConsumed === true;

  const workflowResultConsumed =
    options?.workflowResultConsumed === true || loopState?.workflowResultConsumed === true;

  await appendTurnOutcomeEvent(this, {
    coreError,
    events,
    durationMs: Date.now() - turnMachine.state.startedAt.getTime(),
    turnPhase: turnMachine.state.phase,
    inputId: options?.inputId,
    traceContext: turnTraceContext,
    fallbackMessage: "Turn execution failed",
    logEvent: "turn.failed",
    logLabel: "Turn",
    preserveQueueAutoDrainOnCancel,
    backgroundSubagentResultConsumed,
    workflowResultConsumed,
    historyRoundCount: loopState?.historyRoundCount,
  });

  await recordTurnUsageFact(this, {
    completedAt: Date.now(),
    error: coreError,
    events,
    startedAt: turnStartedAtMs,
    status: coreError.type === CoreErrorType.TurnCancelled ? "cancelled" : "error",
    traceContext: turnTraceContext,
    turnId,
    userMessageId,
  });

  throw coreError;
}

export async function completeHookBlockedTurn(
  this: AgentRuntimeInternal,
  context: TurnCommandPhaseContext,
  outcome: Pick<TurnOutcomeState, "startedTarget" | "turnMachine"> & { response: string },
): Promise<TurnResult> {
  const { options, turnId, traceId, turnTraceContext, turnStartedAtMs, targetRunInputID, events } =
    context;
  const { startedTarget, turnMachine, response } = outcome;

  const turnUsage = createModelUsageSummaryFromEvents(events);
  const completeEvent = this.createEvent(
    SessionEventType.TurnComplete,
    {
      response,
      tokenCount: 0,
      usage: turnUsage,
      toolCallCount: 0,
      duration: Date.now() - turnMachine.state.startedAt.getTime(),
      resultType: "success",
      cacheStats: this.messageHistory.getCacheStats(),
      inputId: options?.inputId,
    },
    turnTraceContext,
  );
  await this.appendEvent(completeEvent, turnTraceContext);
  events.push(completeEvent);
  await recordTurnUsageFact(this, {
    completedAt: Date.now(),
    events,
    startedAt: turnStartedAtMs,
    status: "completed",
    traceContext: turnTraceContext,
    turnId,
  });
  this.turnNumber++;
  const projection = await this.rebuildProjection();
  await this.accountTargetTurnCompletion({
    inputID: targetRunInputID,
    startedAtMs: turnStartedAtMs,
    startedTarget,
    traceContext: turnTraceContext,
    usage: turnUsage,
  });
  return {
    response,
    turnId,
    traceId,
    usage: turnUsage,
    events,
    projection,
  };
}
