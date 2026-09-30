import { classifyModelFailure } from "./failure-classifier.js";

import { unwrapRetryError } from "./failure-inspection.js";

import { admitAttempt, type AttemptAdmission } from "./request-admission.js";

import { toAdapterError } from "./runner-retry.js";
import { admissionWaitPublishers, publishModelStatus } from "./runner-status.js";

import { modelFailureStatusFields } from "./runner-telemetry.js";

import { statusPublishOptions } from "./runner-stream-stream-failure-phase.js";

import type {
  StreamAttemptOutcome,
  StreamAttemptPhaseContext,
} from "./runner-stream-phase-types.js";
export async function admitStreamModelAttempt(
  context: Pick<
    StreamAttemptPhaseContext,
    | "input"
    | "attempt"
    | "startedAt"
    | "resolved"
    | "requestHeaders"
    | "requestHeaderCount"
    | "attemptAbortController"
    | "streamOutputCommitted"
  >,
  outcome: StreamAttemptOutcome,
): Promise<AttemptAdmission> {
  const {
    input,
    attempt,
    startedAt,
    resolved,
    requestHeaders,
    requestHeaderCount,
    attemptAbortController,
    streamOutputCommitted,
  } = context;
  try {
    return await admitAttempt({
      admission: input.request.modelRequestAdmission,
      model: { providerId: String(resolved.providerId), modelId: String(resolved.modelId) },
      signal: input.request.abortSignal,
      ...admissionWaitPublishers(outcome.statusContext, attempt, statusPublishOptions(input)),
    });
  } catch (admitError) {
    attemptAbortController.cleanup();
    const admitFailure = classifyModelFailure(admitError, input.request.abortSignal);
    await publishModelStatus(
      {
        ...outcome.statusContext,
        attempt,
        durationMs: Date.now() - startedAt,
        message: admitFailure.message,
        reason: admitFailure.reason,
        requestHeaderCount,
        requestHeaders,
        retryable: false,
        statusCode: admitFailure.statusCode,
        streamOutputCommitted,
        ...modelFailureStatusFields(admitError, admitFailure, "connect"),
        timestamp: new Date().toISOString(),
        type: "model_request_failed",
      },
      {
        ...statusPublishOptions(input),
        failureError: unwrapRetryError(admitError),
      },
    );
    throw toAdapterError(admitError, admitFailure, outcome.statusContext, attempt, {
      errorPhase: "connect",
    });
  }
}
