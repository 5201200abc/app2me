import { type Attributes, type Context, type Span } from "@opentelemetry/api";
import type {
  AgentTelemetryCancellationReason,
  AgentTelemetryErrorCategory,
  CommandExecutionSpanWriter,
  CommandTraceStart,
} from "@mycode/contracts/telemetry";
import {
  compactAttributes,
  finiteNonNegative,
  integer,
  isAbortLike,
  safeEnum,
  safeIdentifier,
  safeString,
  type ActiveWriterContext,
  type WriterHealth,
  type WriterTerminalObservation,
} from "./agent-trace-support.js";
import { type AgentTelemetryMetricRecorder } from "./agent-metrics.js";
import { commandCompatibilityAttributes } from "./compatibility-adapters.js";
import {
  TrackedBaseWriter,
  type TrackedWriter,
  lifecycleKeys,
  classifyErrorCategory,
} from "./agent-trace-runtime-agent-trace-runtime-options.js";

export function commandMetricLabels(input: CommandTraceStart): Attributes {
  return compactAttributes({
    command_category: safeEnum(input.category),
    command_safe_name: safeString(input.safeName, 128),
  });
}

export class CommandWriter extends TrackedBaseWriter implements CommandExecutionSpanWriter {
  private firstOutput = false;
  private firstOutputMs: number | undefined;

  constructor(
    span: Span,
    parentContext: Context,
    metadata: Omit<ActiveWriterContext, "activeContext" | "span">,
    health: WriterHealth,
    private readonly metrics: AgentTelemetryMetricRecorder,
    metricLabels: Attributes,
    onRemoved: (writer: TrackedWriter) => void,
  ) {
    super(
      span,
      parentContext,
      metadata,
      lifecycleKeys("command_execution"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  markFirstOutput(): void {
    if (this.firstOutput) return;
    this.firstOutput = true;
    const elapsed = this.elapsedMs();
    this.firstOutputMs = elapsed;
    this.setAttribute("mycode.command_execution.first_output_ms", elapsed);
    this.addEvent("first_output");
  }

  markTerminationRequested(reason: "cancelled" | "timeout" | "shutdown"): void {
    this.addEvent("termination_requested", { reason });
  }

  setExitCode(exitCode: number): void {
    const normalized = integer(exitCode);
    this.setAttribute("mycode.command_execution.exit_code", normalized);
    this.setAttributes(commandCompatibilityAttributes({ exitCode: normalized }));
  }

  setSignal(signal: string): void {
    const normalized = safeIdentifier(signal);
    this.setAttribute("mycode.command_execution.signal", normalized);
    this.setAttributes(commandCompatibilityAttributes({ signal: normalized }));
  }

  setOutputBytes(bytes: number): void {
    this.setAttribute("mycode.command_execution.output_bytes", finiteNonNegative(bytes));
  }

  setTimedOut(timedOut: boolean): void {
    this.setAttribute("mycode.command_execution.timed_out", timedOut);
  }

  finishCompleted(): void {
    this.finishCompletedIfOpen();
  }

  finishFailed(
    stage: "prepare" | "spawn" | "execute" | "timeout" | "collect_output" | "unhandled",
    category: AgentTelemetryErrorCategory,
    error?: unknown,
  ): void {
    this.finishFailedIfOpen(stage, category, error);
  }

  finishCancelled(reason: AgentTelemetryCancellationReason): void {
    this.finishCancelledIfOpen(reason);
  }

  finishBackgrounded(): void {
    this.finishDomainOutcomeIfOpen("backgrounded");
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
    if (this.firstOutputMs === undefined) return;
    this.metrics.recordCommandFirstOutput(
      this.firstOutputMs,
      compactAttributes({
        ...this.metricLabels,
        error_category: observation.errorCategory,
        outcome,
      }),
    );
  }
}
