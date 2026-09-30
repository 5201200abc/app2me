import type { Logger, ModelStatusSink } from "@mycode/contracts";

import { createGenerateTextOptions } from "./runner-options.js";

import { createAttemptStatusContext } from "./runner-status.js";
import type { EnvRecord } from "./model-execution.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import type {
  AiSdkModelRuntime,
  AiSdkModelTextRequest,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";

import { type AttemptAdmission } from "./request-admission.js";

export type GenerateTextRunnerInput = {
  debugDir?: string;
  env: EnvRecord;
  logger?: Logger;
  request: AiSdkModelTextRequest;
  resolveModel: () => ResolvedAiSdkModel;
  resolved: ResolvedAiSdkModel;
  retry: ResolvedAiSdkModelRetryOptions;
  runtime: AiSdkModelRuntime;
  statusSink?: ModelStatusSink;
  modelIoFullRetentionEnabled: boolean;
};
export interface GenerateTextAttemptFailureContext {
  attempt: number;
  retryBudgetAttempt: number;
  attemptRequest: AiSdkModelTextRequest;
  startedAt: number;
  resolved: ResolvedAiSdkModel;
  statusContext: ReturnType<typeof createAttemptStatusContext>;
  options: ReturnType<typeof createGenerateTextOptions> | undefined;
  requestInvocationCompleted: boolean;
  requestHeaders: Record<string, string>;
  requestHeaderCount: number;
  admission: AttemptAdmission;
  requestMessages: AiSdkModelTextRequest["messages"];
  signatureRepairAttempted: boolean;
  retryBudget: AiSdkModelTextRequest["modelRetryBudget"];
  statusMaxAttempts: (extraAttempts: number) => number;
  recordModelIO: boolean;
  isDev: boolean;
}
export interface GenerateTextRetryDecision {
  requestMessages: AiSdkModelTextRequest["messages"];
  signatureRepairAttempted: boolean;
  attemptOffset: -1 | 0;
}
