import { type Attributes, type Context, type Span } from "@opentelemetry/api";
import type {
  AgentTelemetryAbandonReason,
  AgentTelemetryCancellationReason,
  AgentTelemetryErrorCategory,
  DetachedOperationSpanWriter,
  DetachedOperationTraceStart,
  ModelAttemptSpanWriter,
  ModelAttemptTraceStart,
  ModelCallFailureStage,
  ModelCallSpanWriter,
  ModelCallTraceStart,
} from "@mycode/contracts/telemetry";
import {
  compactAttributes,
  isAbortLike,
  safeEnum,
  safeString,
  type ActiveWriterContext,
  type WriterHealth,
  type WriterTerminalObservation,
} from "./agent-trace-support.js";
import { type AgentTelemetryMetricRecorder } from "./agent-metrics.js";
import {
  TrackedBaseWriter,
  type TrackedWriter,
  lifecycleKeys,
  classifyErrorCategory,
  NOOP_SCOPE,
} from "./agent-trace-runtime-agent-trace-runtime-options.js";

export function detachedMetricLabels(input: DetachedOperationTraceStart): Attributes {
  return compactAttributes({
    execution_kind: safeEnum(input.executionKind),
    operation: safeEnum(input.operation),
  });
}

export function modelCallMetricLabels(input: ModelCallTraceStart): Attributes {
  return compactAttributes({
    call_cause: safeEnum(input.callCause ?? "initial"),
    model_operation: safeEnum(input.operation),
    model_role: safeEnum(input.modelRole),
  });
}

export class DetachedWriter extends TrackedBaseWriter implements DetachedOperationSpanWriter {
  constructor(
    span: Span,
    parentContext: Context,
    metadata: Omit<ActiveWriterContext, "activeContext" | "span">,
    health: WriterHealth,
    metrics: AgentTelemetryMetricRecorder,
    metricLabels: Attributes,
    onRemoved: (writer: TrackedWriter) => void,
  ) {
    super(
      span,
      parentContext,
      metadata,
      lifecycleKeys("detached_operation"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  setResultType(resultType: "text" | "boolean" | "metadata" | "other"): void {
    this.setAttribute("mycode.detached_operation.result_type", resultType);
  }

  finishCompleted(): void {
    this.finishCompletedIfOpen();
  }

  finishFailed(
    stage: "schedule" | "execute" | "commit" | "unhandled",
    category: AgentTelemetryErrorCategory,
    error?: unknown,
  ): void {
    this.finishFailedIfOpen(stage, category, error);
  }

  finishCancelled(reason: AgentTelemetryCancellationReason): void {
    this.finishCancelledIfOpen(reason);
  }

  protected finishUnhandled(error: unknown): void {
    if (isAbortLike(error)) this.finishCancelledIfOpen("abort_signal");
    else this.finishFailedIfOpen("unhandled", classifyErrorCategory(error), error);
  }
}

export class ModelCallWriter extends TrackedBaseWriter implements ModelCallSpanWriter {
  private attemptCount = 0;
  private hadFailedAttempt = false;
  readonly logicalCallId: string | undefined;
  readonly modelRole: string | undefined;
  readonly operation: string | undefined;

  constructor(
    span: Span,
    parentContext: Context,
    metadata: Omit<ActiveWriterContext, "activeContext" | "span">,
    health: WriterHealth,
    private readonly metrics: AgentTelemetryMetricRecorder,
    metricLabels: Attributes,
    onRemoved: (writer: TrackedWriter) => void,
    private readonly createAttempt: (
      writer: ModelCallWriter,
      input: ModelAttemptTraceStart,
    ) => ModelAttemptSpanWriter,
    logicalCallId: string | undefined,
    operation: string | undefined,
    modelRole: string | undefined,
  ) {
    super(
      span,
      parentContext,
      metadata,
      lifecycleKeys("model_call"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
    this.logicalCallId = logicalCallId;
    this.operation = operation;
    this.modelRole = modelRole;
  }

  startAttempt(input: ModelAttemptTraceStart): ModelAttemptSpanWriter {
    this.attemptCount += 1;
    return this.createAttempt(this, input);
  }

  markFallbackSelected(reason: string): void {
    this.addEvent("fallback_selected", { reason: safeString(reason, 128) });
  }

  recordAttemptFailed(): void {
    this.hadFailedAttempt = true;
  }

  finishCompleted(): void {
    this.finishCompletedIfOpen();
  }

  finishFailed(
    stage: ModelCallFailureStage,
    category: AgentTelemetryErrorCategory,
    error?: unknown,
  ): void {
    this.finishFailedIfOpen(stage, category, error);
  }

  finishAbandoned(reason: AgentTelemetryAbandonReason): void {
    this.finishAbandonedIfOpen(reason);
  }

  finishCancelled(reason: AgentTelemetryCancellationReason): void {
    this.finishCancelledIfOpen(reason);
  }

  protected finishUnhandled(error: unknown): void {
    if (isAbortLike(error)) {
      this.finishCancelledIfOpen("abort_signal");
    } else {
      const category = classifyErrorCategory(error);
      this.finishFailedIfOpen("unhandled", category, error);
    }
  }

  protected override recordTerminalDetailMetrics(
    outcome: string,
    observation: WriterTerminalObservation,
  ): void {
    const retryState =
      this.attemptCount <= 1
        ? "not_needed"
        : outcome === "completed" && this.hadFailedAttempt
          ? "recovered"
          : "not_recovered";
    this.metrics.recordModelCallAttempts(
      this.attemptCount,
      compactAttributes({
        ...this.metricLabels,
        error_category: observation.errorCategory,
        outcome,
        retry_state: retryState,
      }),
    );
  }
}

export const NOOP_DETACHED_WRITER: DetachedOperationSpanWriter = {
  ...NOOP_SCOPE,
  finishCancelled() {},
  finishCompleted() {},
  finishFailed() {},
  setResultType() {},
};

export const NOOP_MODEL_ATTEMPT_WRITER: ModelAttemptSpanWriter = {
  ...NOOP_SCOPE,
  finishAbandoned() {},
  finishCancelled() {},
  finishCompleted() {},
  finishFailed() {},
  markFirstContent() {},
  markFirstProviderEvent() {},
  markFirstText() {},
  markStreamStalled() {},
  setCacheReadTokens() {},
  setCacheWriteTokens() {},
  setEffectiveReasoningBudgetTokens() {},
  setEffectiveReasoningControl() {},
  setEffectiveReasoningLevel() {},
  setEffectiveReasoningState() {},
  setFinishReason() {},
  setHttpStatusCode() {},
  setInputTokens() {},
  setOutputTokens() {},
  setProviderErrorCode() {},
  setProviderErrorMessage() {},
  setProviderRequestId() {},
  setReasoningTokens() {},
  setResponseModel() {},
  setRetryAfterMs() {},
  setStreamOutputCommitted() {},
};

export const NOOP_MODEL_CALL_WRITER: ModelCallSpanWriter = {
  ...NOOP_SCOPE,
  finishAbandoned() {},
  finishCancelled() {},
  finishCompleted() {},
  finishFailed() {},
  markFallbackSelected() {},
  startAttempt: () => NOOP_MODEL_ATTEMPT_WRITER,
};
