import { context, SpanKind } from "@opentelemetry/api";
import type {
  ModelAttemptSpanWriter,
  ModelAttemptTraceStart,
  ModelCallSpanWriter,
  ModelCallTraceStart,
} from "@mycode/contracts/telemetry";
import {
  activeWriterContext,
  compactAttributes,
  executionProjection,
  finiteNonNegative,
  integer,
  safeEnum,
  safeId,
  safeString,
} from "./agent-trace-support.js";

import { modelAttemptCompatibilityAttributes } from "./compatibility-adapters.js";

import { inheritedMetadata } from "./agent-trace-runtime-step-metric-labels.js";
import {
  ModelCallWriter,
  modelCallMetricLabels,
  NOOP_MODEL_CALL_WRITER,
  NOOP_MODEL_ATTEMPT_WRITER,
} from "./agent-trace-runtime-detached-metric-labels.js";

import {
  ModelAttemptWriter,
  modelAttemptMetricLabels,
} from "./agent-trace-runtime-model-attempt-metric-labels.js";
import type { AgentTraceWriterRegistry } from "./agent-trace-writer-registry.js";
export function startModelCall(
  registry: AgentTraceWriterRegistry,
  input: ModelCallTraceStart,
): ModelCallSpanWriter {
  const parent = activeWriterContext();
  return registry.safeCreate(
    "model_call",
    () => {
      const parentContext = parent?.activeContext ?? context.active();
      const span = registry.startSpan({
        attributes: compactAttributes({
          ...executionProjection(parent?.correlation, {
            includeActor: true,
            includeQuery: true,
            includeSession: true,
          }),
          "mycode.execution.logical_call_id": safeId(input.logicalCallId),
          "mycode.model_call.operation": safeEnum(input.operation),
          "mycode.model_call.streaming": input.streaming,
          "mycode.model_call.model_role": safeEnum(input.modelRole),
          "mycode.model_call.requested_provider_id": safeString(input.requested.providerId, 128),
          "mycode.model_call.requested_model": safeString(input.requested.requestedModel, 128),
          "mycode.model_call.reasoning_capability": safeEnum(input.requested.reasoning.capability),
          "mycode.model_call.reasoning_requested_state": safeEnum(
            input.requested.reasoning.requestedState,
          ),
          "mycode.model_call.reasoning_requested_control": safeEnum(
            input.requested.reasoning.requestedControl,
          ),
          "mycode.model_call.reasoning_requested_level": safeString(
            input.requested.reasoning.requestedLevel,
            128,
          ),
          "mycode.model_call.reasoning_requested_budget_tokens": integer(
            input.requested.reasoning.requestedBudgetTokens,
          ),
          "mycode.model_call.call_cause": safeEnum(input.callCause),
          "mycode.model_call.previous_logical_call_id": safeId(input.previousLogicalCallId),
        }),
        context: parentContext,
        correlation: parent?.correlation,
        parent,
        spanName: "model_call",
        toolCallId: parent?.toolCallId,
      });
      return registry.track(
        new ModelCallWriter(
          span,
          parentContext,
          {
            ...inheritedMetadata(parent, "model_call"),
          },
          registry.health,
          registry.metrics,
          modelCallMetricLabels(input),
          (writer) => registry.release(writer),
          (writer, attempt) => startModelAttempt(registry, writer, attempt),
          safeId(input.logicalCallId),
          safeEnum(input.operation),
          safeEnum(input.modelRole),
        ),
      );
    },
    NOOP_MODEL_CALL_WRITER,
  );
}
function startModelAttempt(
  registry: AgentTraceWriterRegistry,
  parentWriter: ModelCallWriter,
  input: ModelAttemptTraceStart,
): ModelAttemptSpanWriter {
  const parent = parentWriter.state;
  return registry.safeCreate(
    "model_attempt",
    () => {
      const target = input.target;
      const span = registry.startSpan({
        attributes: compactAttributes({
          ...executionProjection(parent.correlation, {
            includeActor: true,
            includeQuery: true,
            includeSession: true,
          }),
          "mycode.execution.tool_call_id": safeId(parent.toolCallId),
          "mycode.execution.logical_call_id": parentWriter.logicalCallId,
          "mycode.execution.model_operation": parentWriter.operation,
          "mycode.execution.model_role": parentWriter.modelRole,
          "mycode.model_attempt.request_id": safeId(input.requestId),
          "mycode.model_attempt.attempt_number": integer(input.attemptNumber),
          "mycode.model_attempt.max_attempts": integer(input.maxAttempts),
          "mycode.model_attempt.attempt_cause": safeEnum(input.attemptCause),
          "mycode.model_attempt.previous_request_id": safeId(input.previousRequestId),
          "mycode.model_attempt.retry_delay_ms": finiteNonNegative(input.retryDelayMs),
          "mycode.model_attempt.provider_id": safeString(target.providerId, 128),
          "mycode.model_attempt.provider_kind": safeEnum(target.providerKind),
          "mycode.model_attempt.provider_origin": safeString(target.providerOrigin),
          "mycode.model_attempt.provider_route": safeString(target.providerRoute),
          "mycode.model_attempt.requested_model": safeString(target.requestedModel, 128),
          "mycode.model_attempt.transport": safeEnum(input.transport),
          "mycode.model_attempt.api_operation": safeEnum(input.apiOperation),
          "mycode.model_attempt.reasoning_capability": safeEnum(target.reasoning.capability),
          "mycode.model_attempt.reasoning_requested_state": safeEnum(
            target.reasoning.requestedState,
          ),
          "mycode.model_attempt.reasoning_requested_control": safeEnum(
            target.reasoning.requestedControl,
          ),
          "mycode.model_attempt.reasoning_requested_level": safeString(
            target.reasoning.requestedLevel,
            128,
          ),
          "mycode.model_attempt.reasoning_requested_budget_tokens": integer(
            target.reasoning.requestedBudgetTokens,
          ),
          ...modelAttemptCompatibilityAttributes(target),
        }),
        context: parent.activeContext,
        correlation: parent.correlation,
        kind: SpanKind.CLIENT,
        parent,
        spanName: "model_attempt",
        toolCallId: parent.toolCallId,
      });
      return registry.track(
        new ModelAttemptWriter(
          span,
          parent.activeContext,
          inheritedMetadata(parent, "model_attempt"),
          registry.health,
          registry.metrics,
          modelAttemptMetricLabels(input, parentWriter),
          () => parentWriter.recordAttemptFailed(),
          (writer) => registry.release(writer),
        ),
      );
    },
    NOOP_MODEL_ATTEMPT_WRITER,
  );
}
