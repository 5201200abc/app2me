import { TurnMachineImpl } from "../deps.js";
import type { MessageId, SessionEvent, SessionGoal, TurnState } from "../deps.js";

import type { ActiveTurnSteeringState, ExecuteTurnOptions } from "../types.js";

import type { RegularTurnLoopState } from "./turn-loop-state.js";

import type { TraceContext, TurnId, TraceId } from "@mycode/contracts";
/** Immutable command inputs; the entry point retains mutable turn state and cleanup. */
export interface TurnCommandPhaseContext {
  input: string;
  displayInput: string;
  attachments: TurnState["attachments"];
  options: ExecuteTurnOptions | undefined;
  turnId: TurnId;
  traceId: TraceId;
  turnTraceContext: TraceContext;
  turnAbortSignal: AbortSignal;
  turnStartedAtMs: number;
  targetRunInputID: string;
  events: SessionEvent[];
}
export interface TurnOutcomeState {
  activeTurn: ActiveTurnSteeringState | undefined;
  loopState: RegularTurnLoopState | undefined;
  startedTarget: SessionGoal | null;
  turnMachine: TurnMachineImpl;
  userMessageId: MessageId | undefined;
}
