import { type Attributes, type Context, type Span } from "@opentelemetry/api";
import type {
  AgentStepSpanWriter,
  AgentTelemetryCancellationReason,
  AgentTelemetryErrorCategory,
  AgentTelemetryExecutionContext,
  CommandExecutionSpanWriter,
  CommandTraceStart,
  CompactionTraceStart,
  ContextCompactionSpanWriter,
  ToolExecutionSpanWriter,
} from "@mycode/contracts/telemetry";
import {
  compactAttributes,
  finiteNonNegative,
  isAbortLike,
  safeEnum,
  safeString,
  type ActiveWriterContext,
  type WriterHealth,
} from "./agent-trace-support.js";
import { type AgentTelemetryMetricRecorder } from "./agent-metrics.js";
import {
  TrackedBaseWriter,
  type TrackedWriter,
  lifecycleKeys,
  classifyErrorCategory,
  NOOP_SCOPE,
} from "./agent-trace-runtime-agent-trace-runtime-options.js";

export function stepMetricLabels(
  correlation: AgentTelemetryExecutionContext | undefined,
): Attributes {
  return compactAttributes({
    actor_kind: safeEnum(correlation?.actorKind),
  });
}

export function toolMetricLabels(toolName: string): Attributes {
  return {
    tool_name: safeString(toolName, 128),
  };
}

export function compactionMetricLabels(input: CompactionTraceStart): Attributes {
  return compactAttributes({
    model_mode: safeEnum(input.modelMode),
    trigger: safeEnum(input.trigger),
  });
}

export class ToolWriter extends TrackedBaseWriter implements ToolExecutionSpanWriter {
  private permissionRequested = false;

  constructor(
    span: Span,
    parentContext: Context,
    metadata: Omit<ActiveWriterContext, "activeContext" | "span">,
    health: WriterHealth,
    metrics: AgentTelemetryMetricRecorder,
    metricLabels: Attributes,
    onRemoved: (writer: TrackedWriter) => void,
    private readonly createCommand: (
      input: CommandTraceStart & { parent: ToolWriter },
    ) => CommandExecutionSpanWriter,
  ) {
    super(
      span,
      parentContext,
      metadata,
      lifecycleKeys("tool_execution"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  markPermissionRequested(): void {
    if (this.permissionRequested) return;
    this.permissionRequested = true;
    this.addEvent("permission_requested");
  }

  setPermissionDecision(decision: "granted" | "denied" | "not_required"): void {
    this.setAttribute("mycode.tool_execution.permission_decision", decision);
    if (this.permissionRequested && decision !== "not_required") {
      this.addEvent("permission_decided", { decision });
    }
  }

  setOutputBytes(bytes: number): void {
    this.setAttribute("mycode.tool_execution.output_bytes", finiteNonNegative(bytes));
  }

  setOutputTruncated(truncated: boolean): void {
    this.setAttribute("mycode.tool_execution.output_truncated", truncated);
  }

  startCommand(input: CommandTraceStart): CommandExecutionSpanWriter {
    return this.createCommand({ ...input, parent: this });
  }

  finishCompleted(): void {
    this.finishCompletedIfOpen();
  }

  finishDenied(reason: "user_denied" | "policy_denied" | "unavailable" | "unknown"): void {
    this.finishDomainOutcomeIfOpen("denied", () =>
      this.setAttribute("mycode.tool_execution.permission_denial_reason", reason),
    );
  }

  finishFailed(
    stage:
      | "lookup"
      | "validation"
      | "permission"
      | "pre_hook"
      | "handler"
      | "post_hook"
      | "serialize"
      | "unhandled",
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

export class CompactionWriter extends TrackedBaseWriter implements ContextCompactionSpanWriter {
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
      lifecycleKeys("context_compaction"),
      health,
      metrics,
      metricLabels,
      onRemoved,
    );
  }

  setInputTokens(tokens: number): void {
    this.setAttribute("mycode.context_compaction.input_tokens", finiteNonNegative(tokens));
  }

  setOutputTokens(tokens: number): void {
    this.setAttribute("mycode.context_compaction.output_tokens", finiteNonNegative(tokens));
  }

  markFallbackSelected(reason: string): void {
    this.addEvent("fallback_selected", { reason: safeEnum(reason) });
  }

  finishCompleted(): void {
    this.finishCompletedIfOpen();
  }

  finishDiscarded(): void {
    this.finishDomainOutcomeIfOpen("discarded");
  }

  finishFailed(
    stage: "prepare" | "model" | "parse" | "commit" | "fallback" | "unhandled",
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

export function inheritedMetadata(
  parent: ActiveWriterContext | undefined,
  spanName: string,
): Omit<ActiveWriterContext, "activeContext" | "span"> {
  return {
    correlation: parent?.correlation,
    parent,
    spanName,
    toolCallId: parent?.toolCallId,
  };
}

export const NOOP_COMMAND_WRITER: CommandExecutionSpanWriter = {
  ...NOOP_SCOPE,
  finishBackgrounded() {},
  finishCancelled() {},
  finishCompleted() {},
  finishFailed() {},
  markFirstOutput() {},
  markTerminationRequested() {},
  setExitCode() {},
  setOutputBytes() {},
  setSignal() {},
  setTimedOut() {},
};

export const NOOP_TOOL_WRITER: ToolExecutionSpanWriter = {
  ...NOOP_SCOPE,
  finishCancelled() {},
  finishCompleted() {},
  finishDenied() {},
  finishFailed() {},
  markPermissionRequested() {},
  setOutputBytes() {},
  setOutputTruncated() {},
  setPermissionDecision() {},
  startCommand: () => NOOP_COMMAND_WRITER,
};

export const NOOP_STEP_WRITER: AgentStepSpanWriter = {
  ...NOOP_SCOPE,
  finishCancelled() {},
  finishCompleted() {},
  finishDiscarded() {},
  finishFailed() {},
};

export const NOOP_COMPACTION_WRITER: ContextCompactionSpanWriter = {
  ...NOOP_SCOPE,
  finishCancelled() {},
  finishCompleted() {},
  finishDiscarded() {},
  finishFailed() {},
  markFallbackSelected() {},
  setInputTokens() {},
  setOutputTokens() {},
};
