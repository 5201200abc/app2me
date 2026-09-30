import type { TimelineItem, TraceListResponse, TraceSummary } from "../src/shared.js";
import { isRecord, stringValue } from "./sources.js";
import type {
  DbObservation,
  EventRecord,
  LoadedObservation,
  LogRecord,
  ObservationOptions,
} from "./types.js";
import {
  loadObservation,
  sourceStatuses,
  buildProjectSummaries,
  DEFAULT_TRACE_LIMIT,
  type TraceSummaryDraft,
  sessionIdsForProject,
  ensureTraceSummary,
  addSession,
  addTime,
  recordFirstUserMessage,
  firstUserMessageFromEvent,
  extractUsage,
  compareIsoDesc,
  groupPartsByMessageId,
  textFromDbMessage,
  textFromDbParts,
  textFromPayload,
  arrayValue,
} from "./analyzer-default-trace-limit.js";

export async function listTraces(options: ObservationOptions = {}): Promise<TraceListResponse> {
  const observation = await loadObservation(options);
  return {
    sources: sourceStatuses(observation),
    projects: buildProjectSummaries(observation.db.records[0]),
    traces: buildTraceSummaries(
      observation,
      options.limit ?? DEFAULT_TRACE_LIMIT,
      options.projectId,
    ),
  };
}

export function buildTraceSummaries(
  observation: LoadedObservation,
  limit: number,
  projectId?: string,
): TraceSummary[] {
  const summaries = new Map<string, TraceSummaryDraft>();
  const allowedSessionIds = projectId
    ? sessionIdsForProject(observation.db.records[0], projectId)
    : undefined;

  for (const log of observation.logs.records) {
    if (!log.traceId) continue;
    const summary = ensureTraceSummary(summaries, log.traceId);
    summary.logCount += 1;
    addSession(summary, log.sessionId);
    addTime(summary, log.timestamp);
    summary.lastMessage = log.message ?? log.event ?? summary.lastMessage;
  }

  for (const event of observation.events.records) {
    if (!event.traceId) continue;
    const summary = ensureTraceSummary(summaries, event.traceId);
    summary.eventCount += 1;
    addSession(summary, event.sessionId);
    addTime(summary, event.timestamp);
    summary.lastMessage = event.type;
    recordFirstUserMessage(summary, firstUserMessageFromEvent(event), event.timestamp);
    const usage = extractUsage(event.payload);
    summary.cacheReadTokens += usage.cacheReadTokens;
    summary.cacheWriteTokens += usage.cacheWriteTokens;
  }

  enrichTraceSummariesFromDbMessages(summaries, observation.db.records[0]);

  return [...summaries.values()]
    .filter((summary) => {
      if (!allowedSessionIds) return true;
      return summary.sessionIds.some((sessionId) => allowedSessionIds.has(sessionId));
    })
    .sort((left, right) => compareIsoDesc(left.lastAt, right.lastAt))
    .slice(0, limit)
    .map(toTraceSummary);
}

export function enrichTraceSummariesFromDbMessages(
  summaries: Map<string, TraceSummaryDraft>,
  db?: DbObservation,
): void {
  if (!db || summaries.size === 0) return;
  const bySessionId = new Map<string, TraceSummaryDraft[]>();
  const partsByMessageId = groupPartsByMessageId(db.parts);
  for (const summary of summaries.values()) {
    for (const sessionId of summary.sessionIds) {
      const existing = bySessionId.get(sessionId);
      if (existing) {
        existing.push(summary);
      } else {
        bySessionId.set(sessionId, [summary]);
      }
    }
  }

  for (const message of db.messages) {
    if (message.role !== "user") continue;
    const matchedSummaries = bySessionId.get(message.sessionId);
    if (!matchedSummaries) continue;
    const text = textFromDbMessage(message) ?? textFromDbParts(partsByMessageId.get(message.id));
    for (const summary of matchedSummaries) {
      recordFirstUserMessage(summary, text, message.createdAt);
    }
  }
}

export function toTraceSummary(summary: TraceSummaryDraft): TraceSummary {
  return {
    traceId: summary.traceId,
    sessionIds: summary.sessionIds,
    eventCount: summary.eventCount,
    logCount: summary.logCount,
    firstAt: summary.firstAt,
    lastAt: summary.lastAt,
    firstUserMessage: summary.firstUserMessage,
    lastMessage: summary.lastMessage,
    cacheReadTokens: summary.cacheReadTokens,
    cacheWriteTokens: summary.cacheWriteTokens,
  };
}

export function collectSessionsForTrace(
  traceId: string,
  observation: LoadedObservation,
  explicitSessionId?: string,
): Set<string> {
  const sessions = new Set<string>();
  if (explicitSessionId) sessions.add(explicitSessionId);
  if (traceId.startsWith("session:")) sessions.add(traceId.slice("session:".length));

  for (const log of observation.logs.records) {
    if (log.traceId === traceId && log.sessionId) sessions.add(log.sessionId);
  }
  for (const event of observation.events.records) {
    if (event.traceId === traceId && event.sessionId) sessions.add(event.sessionId);
  }

  return sessions;
}

export function timelineFromLog(log: LogRecord): TimelineItem {
  const label = log.event ?? log.message ?? "log";
  return {
    id: `log:${log.sourcePath}:${log.line}`,
    at: log.timestamp,
    source: "log",
    kind: log.event ?? "log",
    label,
    severity: normalizeLogLevel(log.level),
    traceId: log.traceId,
    sessionId: log.sessionId,
    turnId: log.turnId,
    spanId: log.spanId,
    parentSpanId: log.parentSpanId,
    toolCallId: log.toolCallId,
    summary: log.message ?? log.event ?? "结构化日志条目",
    payload: log.context ?? log.error,
  };
}

export function timelineFromEvent(event: EventRecord): TimelineItem {
  return {
    id: `event:${event.id}`,
    at: event.timestamp,
    source: "eventlog",
    kind: event.type,
    label: event.type,
    traceId: event.traceId,
    sessionId: event.sessionId,
    turnId: event.turnId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId,
    toolCallId: eventToolCallId(event.payload),
    summary: summarizeEvent(event),
    payload: event.payload,
  };
}

export function summarizeEvent(event: EventRecord): string {
  const payload = event.payload;
  switch (event.type) {
    case "model_request": {
      const title = `模型请求 ${modelName(payload) ?? ""}`.trim();
      const messages = summarizeProviderMessages(payload);
      return messages ? `${title}\n${messages}` : title;
    }
    case "model_complete": {
      const usage = extractUsage(payload);
      const title = `模型完成，${usage.totalTokens || usage.inputTokens + usage.outputTokens} Token`;
      const content = textFromPayload(payload);
      return content ? `${title}\n${content}` : title;
    }
    case "tool_call_scheduled":
    case "tool_call_started":
    case "tool_call_result":
    case "tool_call_error":
      return [
        `${stringValue(payload?.toolName) ?? "工具"} ${stringValue(payload?.toolCallId) ?? ""}`.trim(),
        textFromPayload(payload),
      ]
        .filter(Boolean)
        .join("\n");
    case "turn_complete":
      return `轮次完成：${stringValue(payload?.resultType) ?? "success"}`;
    case "user_message":
    case "assistant_message":
      return textFromPayload(payload) ?? String(payload?.content ?? event.type);
    default:
      return [event.type, textFromPayload(payload)].filter(Boolean).join("\n");
  }
}

export function summarizeProviderMessages(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  const messages = arrayValue(payload?.messages).filter(isRecord);
  if (messages.length === 0) return undefined;

  return messages
    .map((message, index) => {
      const role = stringValue(message.role) ?? `message ${index + 1}`;
      const content = textFromPayload(message) ?? stringifyTimelineValue(message);
      return `${role}: ${content}`;
    })
    .join("\n");
}

export function formatRole(role?: string): string {
  switch (role) {
    case "system":
      return "system ";
    case "user":
      return "user ";
    case "assistant":
      return "assistant ";
    case "tool":
      return "tool ";
    default:
      return "";
  }
}

export function eventToolCallId(payload?: Record<string, unknown>): string | undefined {
  return stringValue(payload?.toolCallId);
}

export function modelName(payload?: Record<string, unknown>): string | undefined {
  const modelSelection = isRecord(payload?.modelSelection) ? payload.modelSelection : undefined;
  return stringValue(modelSelection?.modelId) ?? stringValue(payload?.model);
}

export function normalizeLogLevel(level?: string): TimelineItem["severity"] {
  switch (level) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return level;
    default:
      return undefined;
  }
}

export function stringifyTimelineValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
