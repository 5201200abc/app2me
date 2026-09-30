import { CompactPhase, CompactReason, CompactTrigger } from "../deps.js";
import type { SessionEvent, TraceContext } from "../deps.js";

import type { CompactTimelineContext } from "../types.js";
import type { Model } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { CompactAttemptOutcome } from "./turn-loop-state.js";
import { type RuntimeMessageEntry } from "../../agent/message-history.js";

import { selectInitialCompactEntriesForActiveConversation } from "./compact-active-auto-compact-max-attempts.js";
export type ActiveCompactionOptions = {
  abortSignal?: AbortSignal;
  compactContextTelemetry?: {
    inputTokens: number;
    policyContextWindowTokens: number;
    thresholdTokens?: number;
    tokenSource: "estimate" | "provider_usage";
  };
  autoCompactThreshold?: number;
  compactReason?: CompactReason;
  initialPromptTooLongCause?: unknown;
  phase?: CompactPhase;
  sourceCommandId?: string;
  trigger?: CompactTrigger;
  model?: Model;
  activeEntries?: readonly RuntimeMessageEntry[];
};
export type ActiveCompactionResult = {
  displayText: string;
  entries: readonly RuntimeMessageEntry[];
  outcome: Extract<CompactAttemptOutcome, "compacted" | "skipped">;
  tokenCount: number;
};
export interface ActiveCompactionContext {
  customInstructions: string | undefined;
  turnTraceContext: TraceContext;
  events: SessionEvent[];
  options: ActiveCompactionOptions;
  trigger: CompactTrigger;
  phase: CompactPhase;
  compactReason: CompactReason;
  compactModel: Model;
  activeEntries: readonly RuntimeMessageEntry[];
  useMidConversationSystem: boolean | undefined;
  initialSelection: ReturnType<typeof selectInitialCompactEntriesForActiveConversation>;
  preCompactTokenCount: number;
  maxAttempts: number;
  compactTimeline: CompactTimelineContext;
  compactTools: ReturnType<AgentRuntimeInternal["getTools"]>;
}
