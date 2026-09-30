import { createChildTraceContext } from "../deps.js";
import type { MessageId, ModelToolContract } from "../deps.js";
import { type RuntimeMessageEntry } from "../../agent/message-history.js";

import type {
  DrainedPendingInputDiagnostics,
  RunModelTextRequestOptions,
  RuntimeModelStreamSnapshot,
} from "../types.js";

import { captureAssistantPersistenceAnchor } from "./turn-stop.js";
import { createStreamingToolCoordinator } from "./streaming-tool-coordinator.js";

import type { RegularTurnLoopState } from "./turn-loop-state.js";

import { querySourceForTask } from "./turn-model-step-usage.js";

export type ModelBackedTurnStepOptions = {
  drainedSteerForNextRequest?: DrainedPendingInputDiagnostics;
  latestRealUserMessageIndex?: number;
  messages: RunModelTextRequestOptions["messages"];
  sourceEntries: readonly (RuntimeMessageEntry | undefined)[];
  recordedMessages: RunModelTextRequestOptions["messages"];
  requestEntries: readonly RuntimeMessageEntry[];
  tools: ModelToolContract[];
};
/** Immutable per-request references. Mutable turn state remains on RegularTurnLoopState. */
export interface ModelBackedTurnStepContext {
  assistantMessageId: MessageId;
  model: RegularTurnLoopState["model"];
  modelStepIndex: number;
  modelStartedAt: number;
  assistantCreatedAt: number;
  assistantPersistenceAnchor: ReturnType<typeof captureAssistantPersistenceAnchor>;
  querySource: ReturnType<typeof querySourceForTask>;
  executionModelSelection: Pick<RegularTurnLoopState["model"], "providerId" | "modelId">;
  executionContextWindow: RegularTurnLoopState["model"]["properties"]["contextWindow"];
  modelTraceContext: ReturnType<typeof createChildTraceContext>;
  streamingToolCoordinator: ReturnType<typeof createStreamingToolCoordinator>;
  networkEventStartIndex: number;
}
export interface ModelStepFailureObservation {
  readonly latestStreamSnapshot: RuntimeModelStreamSnapshot;
  readonly latestModelRequestId: string | undefined;
  readonly latestFailedModelRequestId: string | undefined;
}
