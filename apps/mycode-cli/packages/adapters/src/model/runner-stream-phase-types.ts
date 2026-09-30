import type { TextStreamPart, ToolSet } from "ai";
import type { Logger, ModelStatusSink } from "@mycode/contracts";

import { createLinkedAbortController } from "./stream-idle-timeout.js";
import { createStreamDiagnostics } from "./runner-diagnostics.js";

import { createStreamTextOptions } from "./runner-options.js";

import { type AttemptAdmission } from "./request-admission.js";

import type { EnvRecord } from "./model-execution.js";

import { createAttemptStatusContext } from "./runner-status.js";
import { StreamingToolCallAssembler } from "./streaming-tool-call-assembler.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import type {
  AiSdkStreamTextResult,
  AiSdkModelRuntime,
  AiSdkModelTextRequest,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";

export type StreamRunInput = {
  debugDir?: string;
  env: EnvRecord;
  logger?: Logger;
  request: AiSdkModelTextRequest;
  resolveModel: () => ResolvedAiSdkModel;
  resolved: ResolvedAiSdkModel;
  retry: ResolvedAiSdkModelRetryOptions;
  runtime: AiSdkModelRuntime;
  statusSink?: ModelStatusSink;
  streamIdleTimeoutMs: number;
  modelIoFullRetentionEnabled: boolean;
};
export interface StreamAttemptOutcome {
  statusContext: ReturnType<typeof createAttemptStatusContext>;
  attemptFailed: boolean;
  awaitIteratorClose: boolean;
  terminalStatusPublished: boolean;
}
export interface StreamAttemptPhaseContext {
  input: StreamRunInput;
  attempt: number;
  startedAt: number;
  recordModelIO: boolean;
  isDev: boolean;
  resolved: ResolvedAiSdkModel;
  options: ReturnType<typeof createStreamTextOptions> | undefined;
  result: AiSdkStreamTextResult | undefined;
  requestHeaders: Record<string, string>;
  requestHeaderCount: number;
  emittedRetryBoundaryEvent: boolean;
  emittedError: boolean;
  emittedEvent: boolean;
  streamIterator: AsyncIterator<TextStreamPart<ToolSet>> | undefined;
  streamReachedNaturalEnd: boolean;
  attemptAbortController: ReturnType<typeof createLinkedAbortController>;
  diagnostics: ReturnType<typeof createStreamDiagnostics>;
  toolCallAssembler: StreamingToolCallAssembler;
  attemptRequest: AiSdkModelTextRequest;
  statusMaxAttempts: (extraAttempts: number) => number;
  retryBudget: AiSdkModelTextRequest["modelRetryBudget"];
  retryBudgetAttempt: number;
  repairThinkingSignatureRejection: (error: unknown) => boolean;
  streamOutputCommitted: boolean;
  timeToFirstProviderEventMs: number | undefined;
  timeToFirstContentMs: number | undefined;
  timeToFirstTextMs: number | undefined;
  streamMaxIdleMs: number;
  streamStallCount: number;
  emptyCompletionRetryCount: number;
  onEmptyCompletionRetry: () => void;
  admission: AttemptAdmission;
}
