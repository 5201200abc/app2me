import { TurnMachineImpl } from "../deps.js";
import type { MessageId } from "../deps.js";

import type { ActiveTurnSteeringState } from "../types.js";

import type { AgentRuntimeInternal } from "../internal.js";

import type { RegularTurnLoopState } from "./turn-loop-state.js";

import type { TurnCommandPhaseContext } from "./turn-command-context.js";
export function initializeRegularTurnLoop(
  this: AgentRuntimeInternal,
  context: TurnCommandPhaseContext,
  execution: {
    activeTurn: ActiveTurnSteeringState;
    loopModel: RegularTurnLoopState["model"];
    userMessageId: MessageId;
    turnMachine: TurnMachineImpl;
    admittedOutputStyle: AgentRuntimeInternal["config"]["outputStyle"];
  },
): RegularTurnLoopState {
  const { input, options, turnId, traceId, turnTraceContext, turnAbortSignal, events } = context;
  const { activeTurn, loopModel, userMessageId, turnMachine, admittedOutputStyle } = execution;
  return {
    activeTurn,
    ...(options?.automationId ? { automationId: options.automationId } : {}),
    // 闲时派发轮的身份进入 loop state，供工具执行边界 deny OffPeakCreate。
    ...(options?.offPeakTaskId ? { offPeakTaskId: options.offPeakTaskId } : {}),
    anomalyWarningsInjected: 0,
    backgroundSubagentResultConsumed: options?.backgroundSubagentResultConsumed === true,
    workflowResultConsumed: options?.workflowResultConsumed === true,
    currentUserMessageId: userMessageId,
    events,
    input,
    modelResponse: "",
    model: loopModel,
    ...(options?.modelExecution?.selectionScope === "execution"
      ? { modelSelectionScope: "execution" as const }
      : {}),
    ...(options?.modelExecution?.subagents && options.intent?.modelSelection
      ? {
          subagentModelOverride: {
            selection: options.intent.modelSelection,
            requestDependencies: options.modelExecution.requestDependencies,
            background: options.modelExecution.subagents.background,
          },
        }
      : {}),
    modelStepCount: 0,
    historyRoundCount: 0,
    reactiveCompactAttemptedInCurrentModelStep: false,
    repeatedToolCallSignature: undefined,
    repeatedToolCallStreakCount: 0,
    stopHookContinuationCount: 0,
    streamRecoveryRetryCount: 0,
    tokenCount: 0,
    toolCallCount: 0,
    turnRequestState: {
      // Turn 只借一次 canonical 成员集合，之后由显式 commit 推进；entry 本身
      // 遵循 MessageHistory 的不可变约定。
      entries: [...this.messageHistory.borrowReadOnlyRuntimeEntries()],
      outputTokenContinuationCount: 0,
    },
    toolDisallowlist: options?.toolDisallowlist,
    traceId,
    turnAbortSignal,
    turnId,
    turnMachine,
    turnOutputStyle: admittedOutputStyle,
    turnTraceContext,
    userMessageId,
  };
}
