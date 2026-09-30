import {
  SessionEventType,
  createQueryId,
  createSessionEvent,
  traceContextToLogContext,
} from "../deps.js";
import type {
  PendingTurnInput,
  QueryId,
  TurnSteerInput,
  TurnSteerResult,
  TurnSteerSource,
} from "../deps.js";
import { measureUtf8Bytes, MAX_TURN_STEER_INPUT_BYTES, previewInput } from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { hasSteerInput } from "./steering-enqueue-deferred-input.js";

export async function steerTurn(
  this: AgentRuntimeInternal,
  input: string | TurnSteerInput,
): Promise<TurnSteerResult> {
  const request = typeof input === "string" ? { input } : input;
  const activeTurn = this.activeTurn;
  const inputSize = measureUtf8Bytes(request.input);
  const inputPreview = previewInput(request.input);

  // 附件输入可以没有正文；旧校验只看 input，导致已 accepted 的附件无法进入权威 queue。
  if (!hasSteerInput(request)) {
    return await this.rejectTurnSteer("empty_input", {
      activeTurn,
      expectedTurnId: request.expectedTurnId,
      inputPreview,
      inputSize,
      traceContext: request.traceContext,
    });
  }

  if (inputSize > MAX_TURN_STEER_INPUT_BYTES) {
    return await this.rejectTurnSteer("input_too_large", {
      activeTurn,
      expectedTurnId: request.expectedTurnId,
      inputPreview,
      inputSize,
      traceContext: request.traceContext,
    });
  }

  if (!activeTurn) {
    return await this.rejectTurnSteer("no_active_turn", {
      expectedTurnId: request.expectedTurnId,
      inputPreview,
      inputSize,
      traceContext: request.traceContext,
    });
  }

  if (request.expectedTurnId !== undefined && request.expectedTurnId !== activeTurn.turnId) {
    return await this.rejectTurnSteer("expected_turn_mismatch", {
      activeTurn,
      expectedTurnId: request.expectedTurnId,
      inputPreview,
      inputSize,
      traceContext: request.traceContext,
    });
  }

  if (!activeTurn.steerable) {
    return await this.rejectTurnSteer("turn_not_steerable", {
      activeTurn,
      expectedTurnId: request.expectedTurnId,
      inputPreview,
      inputSize,
      traceContext: request.traceContext,
    });
  }

  const queryId = request.queryId ?? (request.inputId as QueryId | undefined) ?? createQueryId();
  const commandKind = request.commandKind;
  const source: TurnSteerSource | undefined = request.source;
  const delivery = request.delivery;
  const toolDisallowlist = request.toolDisallowlist;
  const queuePosition = activeTurn.pendingInputs.length;
  const intent = request.intent
    ? {
        ...request.intent,
        admittedDelivery: request.delivery ?? request.intent.admittedDelivery,
        queuePosition,
      }
    : undefined;
  const pendingInput: PendingTurnInput = {
    id:
      request.pendingInputId ??
      request.intent?.queueItemId ??
      this.createPendingInputId(activeTurn.turnId),
    input: request.input,
    queuedAt: new Date(),
    traceId: activeTurn.traceContext.traceId,
    queryId,
    ...(commandKind ? { commandKind } : {}),
    ...(source ? { source } : {}),
    ...(request.inputPresentation ? { inputPresentation: request.inputPresentation } : {}),
    ...(delivery ? { delivery } : {}),
    ...(intent ? { intent } : {}),
    ...(request.attachments ? { attachments: request.attachments } : {}),
    ...(toolDisallowlist ? { toolDisallowlist } : {}),
    turnId: activeTurn.turnId,
  };
  activeTurn.pendingInputs.push(pendingInput);
  const queueLength = activeTurn.pendingInputs.length;
  const event = createSessionEvent(
    SessionEventType.TurnSteerQueued,
    this.sessionId,
    {
      inputId: request.inputId,
      queryId,
      pendingInputId: pendingInput.id,
      input: pendingInput.input,
      inputPreview,
      inputSize,
      ...(commandKind ? { commandKind } : {}),
      ...(source ? { source } : {}),
      ...(request.inputPresentation ? { inputPresentation: request.inputPresentation } : {}),
      ...(delivery ? { delivery } : {}),
      ...(intent ? { intent } : {}),
      ...(toolDisallowlist ? { toolDisallowlist } : {}),
      targetTurnId: activeTurn.turnId,
      queueLength,
    },
    {
      traceId: activeTurn.traceContext.traceId,
      turnId: activeTurn.turnId,
    },
  );
  await this.appendEvent(event, activeTurn.traceContext);
  this.logger?.debug("Turn steer queued", {
    ...traceContextToLogContext(activeTurn.traceContext),
    activeTurnKind: activeTurn.kind,
    activeTurnSteerable: activeTurn.steerable,
    inputId: request.inputId,
    queryId,
    event: "turn.steer.queued",
    expectedTurnId: request.expectedTurnId,
    inputPreview,
    inputSize,
    module: "core.runtime",
    pendingInputId: pendingInput.id,
    queueLength,
    ...(source ? { source } : {}),
    ...(request.inputPresentation ? { inputPresentation: request.inputPresentation } : {}),
    status: "waiting",
    targetTurnId: activeTurn.turnId,
  });

  return {
    kind: "queued",
    pendingInputId: pendingInput.id,
    queueLength,
    turnId: activeTurn.turnId,
  };
}

export { enqueueDeferredInput } from "./steering-enqueue-deferred-input.js";
export { beginActiveTurn } from "./steering-enqueue-deferred-input.js";
export { reserveTurnStart } from "./steering-enqueue-deferred-input.js";
export { releaseTurnStart } from "./steering-enqueue-deferred-input.js";
export { finishActiveTurn } from "./steering-enqueue-deferred-input.js";
export { createPendingInputId } from "./steering-enqueue-deferred-input.js";
export { rejectTurnSteer } from "./steering-enqueue-deferred-input.js";
export { hasPendingInput } from "./steering-enqueue-deferred-input.js";
export { hasInlineGuidePendingInput } from "./steering-has-inline-guide-pending-input.js";
export { fallbackPendingGuidesToQueue } from "./steering-has-inline-guide-pending-input.js";
export { reservePendingInputById } from "./steering-has-inline-guide-pending-input.js";
export { markPendingInputPromoting } from "./steering-has-inline-guide-pending-input.js";
export { releasePendingInputReservation } from "./steering-has-inline-guide-pending-input.js";
export { removePendingInputById } from "./steering-remove-pending-input-by-id.js";
export { discardHeldPendingInputById } from "./steering-remove-pending-input-by-id.js";
export { clearAllPendingInputs } from "./steering-remove-pending-input-by-id.js";
export { editPendingInputById } from "./steering-remove-pending-input-by-id.js";
export { reorderPendingInput } from "./steering-reorder-pending-input.js";
export { setQueueAutoDrain } from "./steering-reorder-pending-input.js";
export { completeExternalQueueDrain } from "./steering-reorder-pending-input.js";
export { setFollowupMode } from "./steering-reorder-pending-input.js";
export { emitModelSelected } from "./steering-reorder-pending-input.js";
export { emitModeChanged } from "./steering-reorder-pending-input.js";
export { drainPendingInput } from "./steering-drain-pending-input.js";
export { discardPendingInput } from "./steering-drain-pending-input.js";
export { discardPersistedPendingSteerInputs } from "./steering-discard-persisted-pending-steer-inputs.js";
