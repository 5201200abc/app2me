import {
  SpanKind,
  type Attributes,
  type Context,
  type Link,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import type {
  AgentStepSpanWriter,
  AgentTelemetryAbandonReason,
  AgentTelemetryCancellationReason,
  AgentTelemetryCausation,
  AgentTelemetryErrorCategory,
  AgentTelemetryExecutionContext,
  AgentTurnSpanWriter,
  AgentTurnTraceStart,
  TelemetryIdentitySnapshot,
} from "@mycode/contracts/telemetry";
import {
  BaseSpanWriter,
  compactAttributes,
  isAbortLike,
  safeEnum,
  spanContextFromCausation,
  type ActiveWriterContext,
  type WriterHealth,
  type WriterLifecycleKeys,
  type WriterTerminalObservation,
} from "./agent-trace-support.js";
import { type AgentMetricSpanName, type AgentTelemetryMetricRecorder } from "./agent-metrics.js";

export interface AgentTraceRuntimeOptions extends WriterHealth {
  identity?: TelemetryIdentitySnapshot;
  maxActiveWriters?: number;
  metrics?: AgentTelemetryMetricRecorder;
  tracer: Tracer;
}

export interface StartWriterOptions {
  attributes?: Attributes;
  context?: Context;
  correlation?: AgentTelemetryExecutionContext;
  kind?: SpanKind;
  links?: Link[];
  parent?: ActiveWriterContext;
  spanName: string;
  toolCallId?: string;
}

export type TrackedWriter = BaseSpanWriter & {
  abandon(reason: AgentTelemetryAbandonReason): void;
  readonly state: ActiveWriterContext;
};

export function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

export function terminalMetricLabels(
  labels: Attributes,
  observation: WriterTerminalObservation,
): Attributes {
  return compactAttributes({
    ...labels,
    error_category: observation.errorCategory,
  });
}

export function turnMetricLabels(
  correlation: AgentTelemetryExecutionContext,
  inputSource: AgentTurnTraceStart["inputSource"],
): Attributes {
  return compactAttributes({
    actor_kind: safeEnum(correlation.actorKind),
    input_source: safeEnum(inputSource),
    launch_surface: safeEnum(correlation.launchSurface),
  });
}

export abstract class TrackedBaseWriter extends BaseSpanWriter {
  protected readonly metricLabels: Attributes;

  constructor(
    span: Span,
    parentContext: Context,
    metadata: Omit<ActiveWriterContext, "activeContext" | "span">,
    lifecycle: WriterLifecycleKeys,
    health: WriterHealth,
    metrics: AgentTelemetryMetricRecorder,
    metricLabels: Attributes,
    onRemoved: (writer: TrackedWriter) => void,
  ) {
    const terminalTarget: { writer?: TrackedBaseWriter } = {};
    super(span, parentContext, metadata, lifecycle, health, (outcome, durationMs, observation) => {
      const writer = terminalTarget.writer;
      if (writer) {
        // 终态 Metric 从 Writer 已记录的实时事实投影，覆盖显式 finish、业务异常、
        // missing_terminal 和进程回收；不能只埋在各 finishXxx 分支里留下缺口。
        writer.safe(() => onRemoved(writer));
        writer.safe(() => writer.recordTerminalDetailMetrics(outcome, observation));
        writer.safe(() =>
          metrics.recordSpanTerminal(
            metadata.spanName as AgentMetricSpanName,
            outcome,
            durationMs,
            terminalMetricLabels(metricLabels, observation),
            observation.abandonReason,
          ),
        );
      }
    });
    terminalTarget.writer = this;
    this.metricLabels = metricLabels;
  }

  abandon(reason: AgentTelemetryAbandonReason): void {
    this.finishAbandonedIfOpen(reason);
  }

  protected recordTerminalDetailMetrics(
    _outcome: string,
    _observation: WriterTerminalObservation,
  ): void {}
}

export function causationLink(
  causation: AgentTelemetryCausation,
  relation: "spawned_by" | "triggered_by" | "resumed_from",
): Link {
  return {
    attributes: {
      "mycode.link.relation": relation,
    },
    context: spanContextFromCausation(causation),
  };
}

export class TurnWriter extends TrackedBaseWriter implements AgentTurnSpanWriter {
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
      lifecycleKeys("agent_turn"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  finishCompleted(
    resultType: "assistant_message" | "tool_request" | "no_output" | "other" = "other",
  ): void {
    this.finishCompletedIfOpen(() =>
      this.setAttribute("mycode.agent_turn.result_type", resultType),
    );
  }

  finishFailed(
    stage: "setup" | "agent_loop" | "finalize" | "unhandled",
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

export class StepWriter extends TrackedBaseWriter implements AgentStepSpanWriter {
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
      lifecycleKeys("agent_step"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  finishCompleted(
    terminalReason:
      | "model_completed"
      | "tool_requested"
      | "turn_completed"
      | "compaction_requested",
  ): void {
    this.metricLabels.terminal_reason = terminalReason;
    this.finishCompletedIfOpen(() =>
      this.setAttribute("mycode.agent_step.terminal_reason", terminalReason),
    );
  }

  finishDiscarded(): void {
    this.finishDomainOutcomeIfOpen("discarded");
  }

  finishFailed(
    stage: "prepare" | "model" | "tool" | "commit" | "unhandled",
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

export function lifecycleKeys(spanName: string): WriterLifecycleKeys {
  const prefix = `mycode.${spanName}`;
  return {
    abandonReason: `${prefix}.abandon_reason`,
    cancelReason: `${prefix}.cancel_reason`,
    errorCategory: `${prefix}.error_category`,
    errorCode: `${prefix}.error_code`,
    errorMessage: `${prefix}.error_message`,
    errorType: `${prefix}.error_type`,
    failureStage: `${prefix}.failure_stage`,
    outcome: `${prefix}.outcome`,
  };
}

export function classifyErrorCategory(error: unknown): AgentTelemetryErrorCategory {
  if (isAbortLike(error)) return "cancelled";
  if (!error || typeof error !== "object") return "unknown";
  const record = error as Record<string, unknown>;
  const status = typeof record.status === "number" ? record.status : record.statusCode;
  if (status === 401 || status === 403) return "authentication";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  const code = String(record.code ?? "").toLowerCase();
  if (code.includes("timeout")) return "timeout";
  if (
    code.includes("network") ||
    code.includes("econn") ||
    code.includes("enotfound") ||
    code.includes("tls")
  ) {
    return "network";
  }
  return "unknown";
}

export const NOOP_SCOPE = {
  captureCausation: () => undefined,
  run: <T>(execute: () => T): T => execute(),
};

export const NOOP_TURN_WRITER: AgentTurnSpanWriter = {
  ...NOOP_SCOPE,
  finishCancelled() {},
  finishCompleted() {},
  finishFailed() {},
};
