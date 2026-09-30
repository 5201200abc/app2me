import { context, SpanKind, type Span, type Tracer } from "@opentelemetry/api";

import { type WriterHealth } from "./agent-trace-support.js";
import {
  NOOP_AGENT_TELEMETRY_METRICS,
  type AgentMetricSpanName,
  type AgentTelemetryMetricRecorder,
} from "./agent-metrics.js";

import {
  type TrackedWriter,
  type AgentTraceRuntimeOptions,
  positiveLimit,
  type StartWriterOptions,
} from "./agent-trace-runtime-agent-trace-runtime-options.js";

/** Owns all live writers and process capacity; span factories share this registry. */
export class AgentTraceWriterRegistry {
  private readonly activeWriters = new Set<TrackedWriter>();

  private capacityWarningActive = false;

  private readonly maxActiveWriters: number;

  private readonly tracer: Tracer;

  readonly health: WriterHealth;

  readonly metrics: AgentTelemetryMetricRecorder;

  abandonSession(sessionId: string): void {
    for (const writer of this.activeWriters) {
      if (writer.state.correlation?.sessionId === sessionId) {
        writer.abandon("session_shutdown");
      }
    }
  }

  abandonProcess(): void {
    for (const writer of this.activeWriters) writer.abandon("process_shutdown");
  }

  startSpan(options: StartWriterOptions): Span {
    return this.tracer.startSpan(
      options.spanName,
      {
        attributes: options.attributes,
        kind: options.kind ?? SpanKind.INTERNAL,
        links: options.links,
      },
      options.context ?? context.active(),
    );
  }

  track<T extends TrackedWriter>(writer: T): T {
    this.activeWriters.add(writer);
    return writer;
  }

  safeCreate<T>(spanName: string, create: () => T, fallback: T): T {
    if (this.activeWriters.size >= this.maxActiveWriters) {
      this.safeMetric(() =>
        this.metrics.recordCreationDrop(spanName as AgentMetricSpanName, "process_capacity"),
      );
      if (!this.capacityWarningActive) {
        this.capacityWarningActive = true;
        try {
          this.health.onWarning?.("Telemetry active writer capacity was reached", {
            activeWriterCount: this.activeWriters.size,
            maxActiveWriters: this.maxActiveWriters,
            spanName,
          });
        } catch {
          // 健康回调同样属于旁路。
        }
      }
      return fallback;
    }
    this.capacityWarningActive = false;
    try {
      return create();
    } catch (error) {
      this.safeMetric(() =>
        this.metrics.recordCreationDrop(spanName as AgentMetricSpanName, "unknown"),
      );
      try {
        this.health.onWarning?.("Telemetry writer creation failed", {
          errorType: error instanceof Error ? error.name : typeof error,
          spanName,
        });
      } catch {
        // 健康回调同样属于旁路。
      }
      return fallback;
    }
  }

  private safeMetric(record: () => void): void {
    try {
      record();
    } catch (error) {
      try {
        this.health.onWarning?.("Telemetry metric operation failed", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      } catch {
        // Metric 与健康回调都属于旁路。
      }
    }
  }
  constructor(options: AgentTraceRuntimeOptions) {
    this.tracer = options.tracer;
    this.maxActiveWriters = positiveLimit(options.maxActiveWriters, 5_000);
    this.health = { onWarning: options.onWarning };
    this.metrics = options.metrics ?? NOOP_AGENT_TELEMETRY_METRICS;
  }
  release(writer: TrackedWriter): void {
    this.activeWriters.delete(writer);
  }
}
