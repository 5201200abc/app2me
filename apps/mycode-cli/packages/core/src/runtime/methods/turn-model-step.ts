import { recoverFailedModelTurnStep } from "./turn-model-step-failure.js";
import { completeModelTurnStep } from "./turn-model-step-completion.js";
import type {
  ModelBackedTurnStepOptions,
  ModelBackedTurnStepContext,
} from "./turn-model-step-types.js";
import { beginLocalTurnPreparation } from "@mycode/contracts";
import {
  SessionEventType,
  createChildTraceContext,
  createMessageId,
  createPartId,
} from "../deps.js";
import type { MessageId, ModelNetworkStatusEvent } from "../deps.js";

import { throwIfTurnAborted, isTurnCancellationError } from "../helpers/index.js";
import type { RuntimeModelStreamSnapshot, RuntimeModelTextResult } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";

import { captureAssistantPersistenceAnchor } from "./turn-stop.js";
import { createStreamingToolCoordinator } from "./streaming-tool-coordinator.js";

import type { RegularTurnLoopState } from "./turn-loop-state.js";

import { querySourceForTask } from "./turn-model-step-usage.js";
import { estimateCurrentModelInputTokens } from "./compact.js";
import {
  resolveModelStepMaxOutputTokens,
  resolveNormalRequestMaxOutputTokens,
} from "./model-token-limits.js";

import { type ModelStepResult } from "./turn-model-step-model-step-result.js";

export async function runModelBackedTurnStep(
  this: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  options: ModelBackedTurnStepOptions,
): Promise<ModelStepResult> {
  const assistantMessageId = createMessageId();
  const stepTelemetry = this.agentTelemetry.step({
    stepId: assistantMessageId,
    stepIndex: state.modelStepCount,
  });
  return stepTelemetry.run(async () => {
    try {
      const result = await runModelBackedTurnStepImpl.call(
        this,
        state,
        options,
        assistantMessageId,
      );
      stepTelemetry.finishCompleted(
        result === "output_continuation"
          ? "model_completed"
          : result === "continue"
            ? "tool_requested"
            : "turn_completed",
      );
      return result;
    } catch (error) {
      if (isTurnCancellationError(error, state.turnAbortSignal)) {
        stepTelemetry.finishCancelled("abort_signal");
      } else {
        stepTelemetry.finishFailed("unhandled", "unknown", error);
      }
      throw error;
    }
  });
}

async function runModelBackedTurnStepImpl(
  this: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  options: ModelBackedTurnStepOptions,
  assistantMessageId: MessageId,
): Promise<ModelStepResult> {
  const model = state.model;
  const modelStepIndex = state.modelStepCount;
  const modelStartedAt = Date.now();
  const assistantCreatedAt = modelStartedAt;
  const assistantPersistenceAnchor = captureAssistantPersistenceAnchor(this);
  const querySource = querySourceForTask(this.config.taskType);
  const executionModelSelection = { providerId: model.providerId, modelId: model.modelId };
  // 请求预算由 Agent 执行链显式决定。普通 Turn 选择打满模型声明的上限，
  // ModelFactory 不再把该请求参数伪装成长期 ModelSelection/Active Model 状态。
  const executionMaxOutputTokens = model.optionSpecs.maxOutputTokens.max;
  const executionContextWindow = model.properties.contextWindow;
  const modelTraceContext = createChildTraceContext(state.turnTraceContext, {
    attributes: {
      providerId: String(model.providerId),
      modelId: String(model.modelId),
      iteration: state.toolCallCount === 0 ? 0 : Math.ceil(state.toolCallCount / 10),
      querySource,
    },
  });

  this.logModelRequestSteeringContext({
    activeTurn: state.activeTurn,
    drained: options.drainedSteerForNextRequest,
    messages: options.messages,
    modelStepCount: state.modelStepCount,
    traceContext: modelTraceContext,
  });
  const finishPersistence = beginLocalTurnPreparation(modelTraceContext, "persistence");
  await this.persistAssistantMessage(
    assistantMessageId,
    state.currentUserMessageId,
    assistantCreatedAt,
    undefined,
    modelTraceContext,
    model,
  );
  await this.persistPart(
    {
      id: createPartId(),
      sessionID: this.sessionId,
      messageID: assistantMessageId,
      type: "step-start",
    },
    modelTraceContext,
  );

  const modelRequestEvent = this.createEvent(
    SessionEventType.ModelRequest,
    {
      // 自动续写提示只属于本次请求，不应写入持久化的 ModelRequest 轨迹。
      messages: options.recordedMessages,
      providerId: String(model.providerId),
      modelId: String(model.modelId),
      querySource,
      toolCount: options.tools.length,
      iteration: state.toolCallCount === 0 ? 0 : Math.ceil(state.toolCallCount / 10),
    },
    modelTraceContext,
  );
  await this.appendEvent(modelRequestEvent, modelTraceContext);
  state.events.push(modelRequestEvent);
  finishPersistence();
  const streamingToolCoordinator = createStreamingToolCoordinator(this, state, {
    assistantMessageId,
    model,
    traceContext: modelTraceContext,
  });
  const networkEventStartIndex = state.events.length;
  let latestStreamSnapshot: RuntimeModelStreamSnapshot = { reasoning: [], text: "" };
  const streamRecoveryRequest = state.pendingStreamRecoveryRequest;
  state.pendingStreamRecoveryRequest = undefined;
  let latestModelRequestId: string | undefined;
  let latestFailedModelRequestId: string | undefined;
  const recordModelNetworkStatus = (event: ModelNetworkStatusEvent): void => {
    if (event.type === "model_request_started") {
      latestModelRequestId = event.requestId;
      return;
    }
    if (event.type === "model_stream_stalled" || event.type === "model_request_failed") {
      latestFailedModelRequestId = event.requestId;
    }
  };

  let result: RuntimeModelTextResult;
  const step: ModelBackedTurnStepContext = {
    assistantMessageId,
    model,
    modelStepIndex,
    modelStartedAt,
    assistantCreatedAt,
    assistantPersistenceAnchor,
    querySource,
    executionModelSelection,
    executionContextWindow,
    modelTraceContext,
    streamingToolCoordinator,
    networkEventStartIndex,
  };

  try {
    const baselineMaxOutputTokens = resolveNormalRequestMaxOutputTokens({
      modelMaxOutputTokens: executionMaxOutputTokens,
    });
    result = await this.runModelTextRequest({
      abortSignal: state.turnAbortSignal,
      assistantMessageId,
      events: state.events,
      maxOutputTokens: resolveModelStepMaxOutputTokens({
        baselineMaxOutputTokens,
        contextWindow: executionContextWindow,
        estimatedCurrentUsage: estimateCurrentModelInputTokens(
          options.messages,
          options.sourceEntries,
        ),
        modelContextBudgetStrategy: this.config.modelContextBudgetStrategy,
      }),
      latestRealUserMessageIndex: options.latestRealUserMessageIndex,
      messages: options.messages,
      sourceEntries: options.sourceEntries,
      model,
      onStreamSnapshot: (snapshot) => {
        latestStreamSnapshot = snapshot;
      },
      onModelNetworkStatus: recordModelNetworkStatus,
      onStreamReasoningDelta: (text) => streamingToolCoordinator.recordReasoningDelta(text),
      onStreamTextDelta: (text) => streamingToolCoordinator.recordTextDelta(text),
      onStreamToolCall: (toolCall) => streamingToolCoordinator.accept(toolCall),
      streamRecovery: streamRecoveryRequest,
      tools: options.tools,
      traceContext: modelTraceContext,
    });
    throwIfTurnAborted(state.turnAbortSignal);
  } catch (error) {
    return recoverFailedModelTurnStep.call(this, state, options, step, error, {
      get latestStreamSnapshot() {
        return latestStreamSnapshot;
      },
      get latestModelRequestId() {
        return latestModelRequestId;
      },
      get latestFailedModelRequestId() {
        return latestFailedModelRequestId;
      },
    });
  }
  return completeModelTurnStep.call(this, state, options, step, result);
}
