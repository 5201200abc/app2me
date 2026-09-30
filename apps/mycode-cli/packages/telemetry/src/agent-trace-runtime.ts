import { AgentTraceWriterRegistry } from "./agent-trace-writer-registry.js";
import { startModelCall } from "./agent-trace-model-writers.js";
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type {
  AgentExecutionTelemetryPort,
  AgentStepSpanWriter,
  AgentStepTraceStart,
  AgentTelemetryExecutionContext,
  AgentTurnSpanWriter,
  AgentTurnTraceStart,
  CommandExecutionSpanWriter,
  CommandTraceStart,
  CompactionTraceStart,
  ContextCompactionSpanWriter,
  DetachedOperationSpanWriter,
  DetachedOperationTraceStart,
  ModelCallSpanWriter,
  ModelCallTraceStart,
  ModelExecutionTelemetryPort,
  TelemetryIdentitySnapshot,
  ToolExecutionSpanWriter,
  ToolTraceStart,
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
  contextFromCausation,
} from "./agent-trace-support.js";

import { toolCompatibilityAttributes } from "./compatibility-adapters.js";
import {
  type AgentTraceRuntimeOptions,
  causationLink,
  TurnWriter,
  turnMetricLabels,
  NOOP_TURN_WRITER,
  StepWriter,
} from "./agent-trace-runtime-agent-trace-runtime-options.js";
import {
  inheritedMetadata,
  stepMetricLabels,
  NOOP_STEP_WRITER,
  ToolWriter,
  toolMetricLabels,
  NOOP_TOOL_WRITER,
  CompactionWriter,
  compactionMetricLabels,
  NOOP_COMPACTION_WRITER,
  NOOP_COMMAND_WRITER,
} from "./agent-trace-runtime-step-metric-labels.js";
import {
  DetachedWriter,
  detachedMetricLabels,
  NOOP_DETACHED_WRITER,
} from "./agent-trace-runtime-detached-metric-labels.js";
import { CommandWriter, commandMetricLabels } from "./agent-trace-runtime-command-metric-labels.js";

export class AgentExecutionTelemetryRuntime
  implements AgentExecutionTelemetryPort, ModelExecutionTelemetryPort
{
  private identity: TelemetryIdentitySnapshot;
  private readonly registry: AgentTraceWriterRegistry;
  constructor(options: AgentTraceRuntimeOptions) {
    this.registry = new AgentTraceWriterRegistry(options);
    this.identity = options.identity ?? { identityState: "unknown" };
  }
  abandonSession(sessionId: string): void {
    this.registry.abandonSession(sessionId);
  }
  abandonProcess(): void {
    this.registry.abandonProcess();
  }

  updateIdentity(snapshot: TelemetryIdentitySnapshot): void {
    this.identity = {
      identityState: snapshot.identityState,
      ...(safeId(snapshot.userSubjectId) ? { userSubjectId: safeId(snapshot.userSubjectId) } : {}),
    };
  }

  captureCausation() {
    const active = activeWriterContext();
    if (!active) return undefined;
    const spanContext = active.span.spanContext();
    if (!trace.isSpanContextValid(spanContext)) return undefined;
    return {
      isRemote: spanContext.isRemote ?? false,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      traceId: spanContext.traceId,
      ...(spanContext.traceState ? { traceState: spanContext.traceState.serialize() } : {}),
      sessionId: active.correlation?.sessionId,
      turnId: active.correlation?.turnId,
      toolCallId: active.toolCallId,
    };
  }

  startTurn(input: AgentTurnTraceStart): AgentTurnSpanWriter {
    const correlation: AgentTelemetryExecutionContext = {
      ...input.context,
      identityState: this.identity.identityState,
      ...(this.identity.userSubjectId ? { userSubjectId: this.identity.userSubjectId } : {}),
    };
    const linkedRoot = input.causationMode !== "child";
    const links =
      input.causation && linkedRoot ? [causationLink(input.causation, "spawned_by")] : undefined;
    return this.registry.safeCreate(
      "agent_turn",
      () => {
        const parentContext =
          input.causation && !linkedRoot ? contextFromCausation(input.causation) : ROOT_CONTEXT;
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(correlation, {
              includeActor: true,
              includeAgent: true,
              includeIdentity: true,
              includeQuery: true,
              includeSession: true,
            }),
            "mycode.agent_turn.turn_number": integer(input.turnNumber),
            "mycode.agent_turn.input_source": safeEnum(input.inputSource),
          }),
          context: parentContext,
          correlation,
          links,
          spanName: "agent_turn",
        });
        return this.registry.track(
          new TurnWriter(
            span,
            parentContext,
            {
              correlation,
              spanName: "agent_turn",
            },
            this.registry.health,
            this.registry.metrics,
            turnMetricLabels(correlation, input.inputSource),
            (writer) => this.registry.release(writer),
          ),
        );
      },
      NOOP_TURN_WRITER,
    );
  }

  startStep(input: AgentStepTraceStart): AgentStepSpanWriter {
    const parent = activeWriterContext();
    return this.registry.safeCreate(
      "agent_step",
      () => {
        const parentContext = parent?.activeContext ?? context.active();
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(parent?.correlation),
            "mycode.agent_step.step_id": safeId(input.stepId),
            "mycode.agent_step.step_index": integer(input.stepIndex),
          }),
          context: parentContext,
          correlation: parent?.correlation,
          parent,
          spanName: "agent_step",
          toolCallId: parent?.toolCallId,
        });
        return this.registry.track(
          new StepWriter(
            span,
            parentContext,
            inheritedMetadata(parent, "agent_step"),
            this.registry.health,
            this.registry.metrics,
            stepMetricLabels(parent?.correlation),
            (writer) => this.registry.release(writer),
          ),
        );
      },
      NOOP_STEP_WRITER,
    );
  }

  startTool(input: ToolTraceStart): ToolExecutionSpanWriter {
    const parent = activeWriterContext();
    return this.registry.safeCreate(
      "tool_execution",
      () => {
        const parentContext = parent?.activeContext ?? context.active();
        const toolName = safeString(input.registeredToolName, 128);
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(parent?.correlation, { includeActor: true }),
            "mycode.execution.tool_call_id": safeId(input.toolCallId),
            "mycode.tool_execution.tool_name": toolName,
            ...toolCompatibilityAttributes({
              toolCallId: input.toolCallId,
              toolName: input.registeredToolName,
            }),
          }),
          context: parentContext,
          correlation: parent?.correlation,
          parent,
          spanName: "tool_execution",
          toolCallId: safeId(input.toolCallId),
        });
        return this.registry.track(
          new ToolWriter(
            span,
            parentContext,
            {
              ...inheritedMetadata(parent, "tool_execution"),
              toolCallId: safeId(input.toolCallId),
            },
            this.registry.health,
            this.registry.metrics,
            toolMetricLabels(input.registeredToolName),
            (writer) => this.registry.release(writer),
            (command) => this.startCommand(command),
          ),
        );
      },
      NOOP_TOOL_WRITER,
    );
  }

  startCompaction(input: CompactionTraceStart): ContextCompactionSpanWriter {
    const parent = activeWriterContext();
    return this.registry.safeCreate(
      "context_compaction",
      () => {
        const parentContext = parent?.activeContext ?? context.active();
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(parent?.correlation),
            "mycode.context_compaction.trigger": safeEnum(input.trigger),
            "mycode.context_compaction.phase": safeEnum(input.phase),
            "mycode.context_compaction.model_mode": safeEnum(input.modelMode),
            "mycode.context_compaction.outer_attempt": integer(input.outerAttempt),
            "mycode.context_compaction.max_attempts": integer(input.maxAttempts),
            "mycode.context_compaction.triggering_step_index": integer(input.triggeringStepIndex),
            "mycode.context_compaction.policy_context_window_tokens": finiteNonNegative(
              input.policyContextWindowTokens,
            ),
            "mycode.context_compaction.threshold_tokens": finiteNonNegative(input.thresholdTokens),
            "mycode.context_compaction.token_source": safeEnum(input.tokenSource),
            "mycode.context_compaction.recovered_from_logical_call_id": safeId(
              input.recoveredFromLogicalCallId,
            ),
          }),
          context: parentContext,
          correlation: parent?.correlation,
          parent,
          spanName: "context_compaction",
          toolCallId: parent?.toolCallId,
        });
        return this.registry.track(
          new CompactionWriter(
            span,
            parentContext,
            inheritedMetadata(parent, "context_compaction"),
            this.registry.health,
            this.registry.metrics,
            compactionMetricLabels(input),
            (writer) => this.registry.release(writer),
          ),
        );
      },
      NOOP_COMPACTION_WRITER,
    );
  }

  startDetachedOperation(input: DetachedOperationTraceStart): DetachedOperationSpanWriter {
    const linkedRoot = input.executionKind !== "foreground";
    const links =
      input.causation && linkedRoot
        ? [
            causationLink(
              input.causation,
              input.trigger === "recovery" ? "resumed_from" : "triggered_by",
            ),
          ]
        : undefined;
    return this.registry.safeCreate(
      "detached_operation",
      () => {
        const parentContext =
          input.causation && !linkedRoot ? contextFromCausation(input.causation) : ROOT_CONTEXT;
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(input.context, {
              includeActor: true,
              includeQuery: true,
              includeSession: true,
            }),
            "mycode.detached_operation.operation": safeEnum(input.operation),
            "mycode.detached_operation.execution_kind": safeEnum(input.executionKind),
            "mycode.detached_operation.trigger": safeEnum(input.trigger),
            "mycode.detached_operation.target_kind": safeEnum(input.targetKind),
            "mycode.detached_operation.goal_iteration": integer(input.goalIteration),
            "mycode.detached_operation.chunk_index": integer(input.chunkIndex),
            "mycode.detached_operation.chunk_count": integer(input.chunkCount),
          }),
          context: parentContext,
          correlation: input.context,
          links,
          spanName: "detached_operation",
        });
        return this.registry.track(
          new DetachedWriter(
            span,
            parentContext,
            {
              correlation: input.context,
              spanName: "detached_operation",
            },
            this.registry.health,
            this.registry.metrics,
            detachedMetricLabels(input),
            (writer) => this.registry.release(writer),
          ),
        );
      },
      NOOP_DETACHED_WRITER,
    );
  }
  startCall(input: ModelCallTraceStart): ModelCallSpanWriter {
    return startModelCall(this.registry, input);
  }

  private startCommand(
    input: CommandTraceStart & { parent: ToolWriter },
  ): CommandExecutionSpanWriter {
    const parent = input.parent.state;
    return this.registry.safeCreate(
      "command_execution",
      () => {
        const span = this.registry.startSpan({
          attributes: compactAttributes({
            ...executionProjection(parent.correlation),
            "mycode.execution.tool_call_id": safeId(parent.toolCallId),
            "mycode.command_execution.safe_name": safeString(input.safeName, 128),
            "mycode.command_execution.category": safeEnum(input.category),
            "mycode.command_execution.command_count": integer(input.commandCount),
            "mycode.command_execution.shell_kind": safeEnum(input.shellKind),
            "mycode.command_execution.sandboxed": input.sandboxed,
          }),
          context: parent.activeContext,
          correlation: parent.correlation,
          parent,
          spanName: "command_execution",
          toolCallId: parent.toolCallId,
        });
        return this.registry.track(
          new CommandWriter(
            span,
            parent.activeContext,
            inheritedMetadata(parent, "command_execution"),
            this.registry.health,
            this.registry.metrics,
            commandMetricLabels(input),
            (writer) => this.registry.release(writer),
          ),
        );
      },
      NOOP_COMMAND_WRITER,
    );
  }
}

export type { AgentTraceRuntimeOptions } from "./agent-trace-runtime-agent-trace-runtime-options.js";
export { NoopAgentExecutionTelemetry } from "./agent-trace-runtime-noop-agent-execution-telemetry.js";
