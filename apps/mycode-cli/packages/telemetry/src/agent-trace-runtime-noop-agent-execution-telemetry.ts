import type {
  AgentExecutionTelemetryPort,
  AgentStepSpanWriter,
  AgentTurnSpanWriter,
  ContextCompactionSpanWriter,
  DetachedOperationSpanWriter,
  ModelCallSpanWriter,
  ModelExecutionTelemetryPort,
  ToolExecutionSpanWriter,
} from "@mycode/contracts/telemetry";
import {
  NOOP_MODEL_CALL_WRITER,
  NOOP_DETACHED_WRITER,
} from "./agent-trace-runtime-detached-metric-labels.js";
import {
  NOOP_COMPACTION_WRITER,
  NOOP_STEP_WRITER,
  NOOP_TOOL_WRITER,
} from "./agent-trace-runtime-step-metric-labels.js";
import { NOOP_TURN_WRITER } from "./agent-trace-runtime-agent-trace-runtime-options.js";

export class NoopAgentExecutionTelemetry
  implements AgentExecutionTelemetryPort, ModelExecutionTelemetryPort
{
  abandonSession(): void {}
  captureCausation() {
    return undefined;
  }
  startCall(): ModelCallSpanWriter {
    return NOOP_MODEL_CALL_WRITER;
  }
  startCompaction(): ContextCompactionSpanWriter {
    return NOOP_COMPACTION_WRITER;
  }
  startDetachedOperation(): DetachedOperationSpanWriter {
    return NOOP_DETACHED_WRITER;
  }
  startStep(): AgentStepSpanWriter {
    return NOOP_STEP_WRITER;
  }
  startTool(): ToolExecutionSpanWriter {
    return NOOP_TOOL_WRITER;
  }
  startTurn(): AgentTurnSpanWriter {
    return NOOP_TURN_WRITER;
  }
}
