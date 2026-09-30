import { prepareTurnInput } from "./turn-input-preparation.js";
import {
  completeRegularTurn,
  failRegularTurn,
  completeHookBlockedTurn,
} from "./turn-lifecycle-outcomes.js";
import { initializeRegularTurnLoop } from "./turn-initialize-loop.js";
import { createTurnPhaseTimers } from "./turn-phase-timing.js";
import type { TurnCommandPhaseContext } from "./turn-command-context.js";
import { beginLocalTurnPreparation } from "@mycode/contracts";

import {
  HookEventName,
  SessionEventType,
  createChildTraceContext,
  createQueryId,
  createMessageId,
  createTurnId,
  runWithContextAsync,
  traceContextToLogContext,
  TurnMachineImpl,
} from "../deps.js";
import type {
  HookRunResult,
  MessageId,
  QueryId,
  SessionEvent,
  SessionGoal,
  TurnState,
} from "../deps.js";
import {
  parseCompactCommand,
  parseRewindCommand,
  createTurnAbortScope,
  throwIfTurnAborted,
  createTurnFailureError,
  isTurnCancellationError,
  appendTurnOutcomeEvent,
  summarizeTurnAttachmentsForEvent,
} from "../helpers/index.js";
import type { ActiveTurnSteeringState, ExecuteTurnOptions, TurnResult } from "../types.js";
import type { ActiveTurnStartReservation } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { runRegularTurnLoop } from "./turn-loop.js";

import type { RegularTurnLoopState } from "./turn-loop-state.js";
import { finishOutputTokenRecovery } from "./turn-output-token-continuation.js";

import {
  closeGoalStateChangeReminderDeferral,
  openGoalStateChangeReminderDeferral,
} from "./goal-state-reminder.js";

import { clearBrowserTurnState } from "../../repl/browser-turn-state.js";
import { applySubmissionExecutionState, createTurnModel } from "./turn-model.js";
import { rebuildContextPrefix } from "./context-refresh.js";
import { TARGET_RUN_HEARTBEAT_MS } from "./turn-execute-turn.js";

export async function executeTurnCommand(
  this: AgentRuntimeInternal,
  input: string,
  attachments?: TurnState["attachments"],
  options?: ExecuteTurnOptions,
  startReservation?: ActiveTurnStartReservation,
): Promise<TurnResult> {
  // 普通 Turn 过去在异步初始化完成后才读取 Session Selection/输出样式，
  // 初始化期间发生的切模会越过 admission 边界，错误影响已经开始的 Turn。
  // 这里在任何 await 之前冻结本轮事实；后续配置变化只作用于下一轮。
  const admittedModelSelection = options?.intent?.modelSelection ?? this.getSessionModelSelection();
  const admittedOutputStyle = this.config.outputStyle;
  const compactInstructions = parseCompactCommand(input);
  const rewindCommand = parseRewindCommand(input);
  const turnId = startReservation?.turnId ?? createTurnId();
  const queryId = options?.queryId ?? (options?.inputId as QueryId | undefined) ?? createQueryId();
  const displayInput = options?.displayInput ?? input;
  const turnTraceContext =
    startReservation?.traceContext ??
    createChildTraceContext(options?.traceContext ?? this.rootTraceContext, {
      queryId,
      sessionId: this.sessionId,
      turnId,
      attributes: {
        turnNumber: this.turnNumber,
      },
    });
  const traceId = turnTraceContext.traceId;
  const turnStartedAtMs = Date.now();
  const targetRunInputID = options?.inputId ?? String(turnId);
  const events: SessionEvent[] = [];
  let turnMachine = TurnMachineImpl.create(this.sessionId, this.turnNumber, input, traceId, turnId);
  this.currentTurnFileChanges = new Map();
  if (!startReservation) this.reserveTurnStart(turnId, turnTraceContext, "regular");

  const turnAbortScope = createTurnAbortScope(options?.abortSignal);
  const turnAbortSignal = turnAbortScope.signal;
  let activeTurn: ActiveTurnSteeringState | undefined;
  let startedTarget: SessionGoal | null = null;
  let targetRunHeartbeat: ReturnType<typeof setInterval> | undefined;
  let userMessageId: MessageId | undefined;
  let loopState: RegularTurnLoopState | undefined;
  let shouldRetryTitleGenerationAfterTurn = false;
  const commandContext: TurnCommandPhaseContext = {
    input,
    displayInput,
    attachments,
    options,
    turnId,
    traceId,
    turnTraceContext,
    turnAbortSignal,
    turnStartedAtMs,
    targetRunInputID,
    events,
  };

  let turnFailureHandled = false;
  const turnPhases = createTurnPhaseTimers.call(this, turnTraceContext);
  const { startTurnPhase, completeTurnPhase } = turnPhases;

  const turnTelemetry = this.agentTelemetry.turn({
    inputSource: options?.inputSource,
    traceContext: turnTraceContext,
    turnNumber: this.turnNumber,
  });

  const execute = () =>
    runWithContextAsync(turnTraceContext, async () => {
      const executionStartedAt = performance.timeOrigin + performance.now();
      beginLocalTurnPreparation(turnTraceContext, "execution")();
      throwIfTurnAborted(turnAbortSignal);
      let admittedModel;
      try {
        admittedModel =
          rewindCommand === null
            ? createTurnModel(this, {
                requestDependencies: options?.modelExecution?.requestDependencies,
                selection: admittedModelSelection,
              })
            : undefined;
      } catch (error) {
        // 同步滞后/模型失效可在内层 Turn try 之前创建失败。只写日志会让已接纳输入
        // 没有终态、桌面与手机都看不到错误；复用 outcome，不等待同步、不改原选择。
        turnFailureHandled = true;
        const coreError = createTurnFailureError(error, turnAbortSignal, "Model creation failed");
        await appendTurnOutcomeEvent(this, {
          coreError,
          events,
          durationMs: Date.now() - turnStartedAtMs,
          turnPhase: "model_creation",
          inputId: options?.inputId,
          traceContext: turnTraceContext,
          fallbackMessage: "Model creation failed",
          logEvent: "turn.failed",
          logLabel: "Turn",
        });
        throw coreError;
      }
      let phaseStartedAt = startTurnPhase("context_initialization");
      if (this.contextInitialized) {
        // 每个后续 model step 都按该步骤实际持有的 Model 重新投影 Context；
        // Session Selection 只决定未来创建哪个 Model，不能充当执行事实。
        rebuildContextPrefix(this, { model: admittedModel });
      } else {
        // 首轮初始化已经用 admitted Model 构造并安装完整 Context，随后再 rebuild
        // 会把同一 Prefix 连续构造两次。未初始化与已初始化分支互斥，每个 model step 只构造一次。
        await this.ensureContextInitialized(turnTraceContext, admittedModel);
      }
      completeTurnPhase("context_initialization", phaseStartedAt);
      throwIfTurnAborted(turnAbortSignal);
      phaseStartedAt = startTurnPhase("session_start_hooks");
      const sessionStartHookResult = await this.runSessionStartHooks(
        "startup",
        turnTraceContext,
        turnAbortSignal,
        admittedModel,
      );
      completeTurnPhase("session_start_hooks", phaseStartedAt);
      this.injectHookAdditionalContextIntoMessageHistory(
        HookEventName.SessionStart,
        sessionStartHookResult.additionalContexts,
      );

      if (compactInstructions !== null) {
        const compactModel = await applySubmissionExecutionState(
          this,
          options?.intent,
          turnTraceContext,
          options?.modelExecution,
          admittedModel,
        );
        return this.executeManualCompact(
          input,
          compactInstructions,
          turnId,
          turnTraceContext,
          turnAbortSignal,
          options?.inputId,
          compactModel,
        );
      }
      if (rewindCommand !== null) {
        return this.executeRewindCommand(
          input,
          rewindCommand,
          turnId,
          turnTraceContext,
          turnAbortSignal,
          options?.inputId,
        );
      }
      activeTurn = this.beginActiveTurn(turnId, turnTraceContext, "regular", true, {
        ...(options?.inputId === undefined ? {} : { inputId: options.inputId }),
      });
      this.logger?.info("Turn started", {
        ...traceContextToLogContext(turnTraceContext),
        event: "turn.started",
        inputLength: input.length,
        module: "core.runtime",
        status: "started",
      });

      turnMachine = new TurnMachineImpl(turnMachine.start());
      phaseStartedAt = startTurnPhase("session_persistence");
      await this.ensureSessionPersisted(displayInput, turnTraceContext);
      // execution-scoped 临时 Provider（例如闲时任务）拥有本轮自己的模型，不改写
      // Session Selection；普通 Submission 才在真正开跑时应用其原子选择。
      const submissionModel = await applySubmissionExecutionState(
        this,
        options?.intent,
        turnTraceContext,
        options?.modelExecution,
        admittedModel,
      );
      startedTarget = await this.readSessionTargetForContext(turnTraceContext);
      completeTurnPhase("target_read", phaseStartedAt);
      if (startedTarget?.status !== "active") {
        startedTarget = null;
      }
      userMessageId =
        options?.skipInputRecord === true
          ? (options.recordedInputMessageId ?? createMessageId())
          : createMessageId();
      // 附件展示元信息随 TurnStarted 下发（v4 投影 → userInput row.attachments）。
      // workspace checkpoint 挂在 user messageId 上；先生成 id 再发 TurnStarted，
      // v4 投影才能用 turn rowId 找回该轮文件 checkpoint，避免摘要有计数但展开查空。
      const attachmentMetas = summarizeTurnAttachmentsForEvent(attachments);
      const turnStartedEvent = this.createEvent(
        SessionEventType.TurnStarted,
        {
          executionStartedAt,
          turnNumber: this.turnNumber,
          input: displayInput,
          messageId: userMessageId,
          inputId: options?.inputId,
          ...(options?.automationId
            ? { automationId: options.automationId }
            : options?.offPeakTaskId
              ? {
                  offPeakTaskId: options.offPeakTaskId,
                  ...(options.offPeakRunType ? { offPeakRunType: options.offPeakRunType } : {}),
                }
              : {}),
          foregroundExecutionId: this.activeForegroundExecution?.foregroundExecutionId,
          queryId,
          inputSource: options?.inputSource,
          inputVisibility: options?.inputVisibility,
          originMeta: options?.originMeta,
          ...(options?.epilogueStart === undefined ? {} : { epilogueStart: options.epilogueStart }),
          ...(options?.backgroundSource ? { backgroundSource: options.backgroundSource } : {}),
          targetId: options?.targetId,
          ...(options?.intent ? { intent: options.intent } : {}),
          ...(attachmentMetas ? { attachments: attachmentMetas } : {}),
        },
        turnTraceContext,
      );
      phaseStartedAt = startTurnPhase("turn_started_event");
      await this.appendEvent(turnStartedEvent, turnTraceContext);
      completeTurnPhase("turn_started_event", phaseStartedAt);
      events.push(turnStartedEvent);
      phaseStartedAt = startTurnPhase("target_accounting");
      startedTarget = await this.startTargetTurnAccounting({
        inputID: targetRunInputID,
        startedAtMs: turnStartedAtMs,
        startedTarget,
        traceContext: turnTraceContext,
      });
      completeTurnPhase("target_accounting", phaseStartedAt);
      if (startedTarget && this.sessionStore?.heartbeatTargetRun) {
        targetRunHeartbeat = setInterval(() => {
          void this.trackResidencyBlockingWork(
            this.heartbeatTargetTurnAccounting({
              inputID: targetRunInputID,
              seenAtMs: Date.now(),
              startedTarget,
              traceContext: turnTraceContext,
            }),
          );
        }, TARGET_RUN_HEARTBEAT_MS);
        if (typeof targetRunHeartbeat === "object" && "unref" in targetRunHeartbeat) {
          targetRunHeartbeat.unref();
        }
      }

      try {
        phaseStartedAt = startTurnPhase("user_prompt_hooks");
        const userPromptHookResult: HookRunResult = options?.skipUserPromptSubmitHooks
          ? { additionalContexts: [] }
          : await this.runUserPromptSubmitHooks(
              input,
              attachments,
              turnTraceContext,
              turnAbortSignal,
            );
        completeTurnPhase("user_prompt_hooks", phaseStartedAt);
        if (userPromptHookResult.preventContinuation) {
          const response =
            userPromptHookResult.stopReason ?? "Prompt blocked by UserPromptSubmit hook.";
          if (activeTurn) activeTurn.steerable = false;
          turnMachine = new TurnMachineImpl(turnMachine.complete(response, "success"));
          return await completeHookBlockedTurn.call(this, commandContext, {
            startedTarget,
            turnMachine,
            response,
          });
        }
        shouldRetryTitleGenerationAfterTurn = await prepareTurnInput.call(
          this,
          commandContext,
          userMessageId,
          userPromptHookResult,
        );

        this.messageHistory.setCacheMiss();
        const loopModel = submissionModel ?? admittedModel;
        if (!loopModel) {
          throw new Error("Turn model was not created before execution");
        }
        loopState = initializeRegularTurnLoop.call(this, commandContext, {
          activeTurn,
          loopModel,
          userMessageId,
          turnMachine,
          admittedOutputStyle,
        });

        openGoalStateChangeReminderDeferral(activeTurn);
        phaseStartedAt = startTurnPhase("regular_turn_loop");
        try {
          await runRegularTurnLoop.call(this, loopState);
          completeTurnPhase("regular_turn_loop", phaseStartedAt);
        } finally {
          finishOutputTokenRecovery(loopState.turnRequestState);
          await closeGoalStateChangeReminderDeferral.call(this, activeTurn, turnTraceContext);
        }
        turnMachine = loopState.turnMachine;
        return await completeRegularTurn.call(this, commandContext, {
          loopState,
          startedTarget,
          turnMachine,
          userMessageId,
          shouldRetryTitleGenerationAfterTurn,
        });
      } catch (error) {
        turnFailureHandled = true;
        return await failRegularTurn.call(
          this,
          commandContext,
          { activeTurn, loopState, startedTarget, turnMachine, userMessageId },
          error,
          (target) => {
            startedTarget = target;
          },
        );
      }
    }).then(
      (result) => {
        turnTelemetry.finishCompleted("assistant_message");
        return result;
      },
      (error: unknown) => {
        if (!turnFailureHandled) {
          this.logger?.warn("Turn execution escaped lifecycle handler", {
            ...traceContextToLogContext(turnTraceContext),
            durationMs: Date.now() - turnStartedAtMs,
            errorMessage: error instanceof Error ? error.message : String(error),
            event: "turn.lifecycle.unhandled_rejection",
            module: "core.runtime",
            phase: turnPhases.currentPhase,
            status: "failed",
          });
        }
        if (isTurnCancellationError(error, turnAbortSignal)) {
          turnTelemetry.finishCancelled("abort_signal");
        } else {
          turnTelemetry.finishFailed("unhandled", "unknown", error);
        }
        throw error;
      },
    );

  return turnTelemetry.run(execute).finally(async () => {
    if (targetRunHeartbeat) {
      clearInterval(targetRunHeartbeat);
    }
    this.releaseTurnStart(turnId);
    clearBrowserTurnState(this.sessionId, turnId);
    this.finishActiveTurn(activeTurn);
    turnAbortScope.dispose();
    try {
      await this.browserControlPort?.turnEnded?.({
        sessionId: this.sessionId,
        turnId: String(turnId),
        traceContext: turnTraceContext,
      });
    } catch (error) {
      // 生命周期清理失败不能覆盖已经完成/失败的主 turn；backend 会在 session close 再兜底释放。
      this.logger?.warn("Browser turn cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        event: "browser.turn_cleanup.failed",
        turnId: String(turnId),
      });
    }
  });
}

export { executeTurn } from "./turn-execute-turn.js";
