import type { TimelineItem, TraceSpan, TraceSpanLane, TraceSpanStatus } from "../src/shared.js";
import { stringValue } from "./sources.js";
import type {
  DbMessageRecord,
  DbPartRecord,
  EventRecord,
  LoadedObservation,
  LogRecord,
} from "./types.js";
import {
  timelineFromLog,
  timelineFromEvent,
  formatRole,
  eventToolCallId,
  summarizeEvent,
} from "./analyzer-list-traces.js";
import { compareIsoDesc } from "./analyzer-default-trace-limit.js";

export function buildTimeline(
  traceId: string,
  sessions: Set<string>,
  observation: LoadedObservation,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const log of observation.logs.records) {
    if (log.traceId !== traceId) continue;
    items.push(timelineFromLog(log));
  }

  for (const event of observation.events.records) {
    if (event.traceId !== traceId) continue;
    items.push(timelineFromEvent(event));
  }

  const db = observation.db.records[0];
  if (db && sessions.size > 0) {
    for (const message of db.messages) {
      if (sessions.has(message.sessionId)) {
        items.push(timelineFromDbMessage(message));
      }
    }
    for (const part of db.parts) {
      if (sessions.has(part.sessionId)) {
        items.push(timelineFromDbPart(part));
      }
    }
  }

  return items.sort((left, right) => compareIsoDesc(left.at, right.at));
}

export function timelineFromDbMessage(message: DbMessageRecord): TimelineItem {
  return {
    id: `sqlite:message:${message.id}`,
    at: message.createdAt,
    source: "sqlite",
    kind: "message",
    label: `${formatRole(message.role)}消息`,
    sessionId: message.sessionId,
    summary: summarizeDbMessage(message),
    payload: message.data,
  };
}

export function timelineFromDbPart(part: DbPartRecord): TimelineItem {
  return {
    id: `sqlite:part:${part.id}`,
    at: part.createdAt,
    source: "sqlite",
    kind: `part:${part.type ?? "unknown"}`,
    label: `${part.type ?? "未知"} 片段`,
    sessionId: part.sessionId,
    summary: summarizeDbPart(part),
    payload: part.data,
  };
}

export type SpanPairConfig = {
  lane: TraceSpanLane;
  startType: string;
  endTypes: string[];
  label: (event: EventRecord) => string;
  match: (start: EventRecord, end: EventRecord) => boolean;
};

export function spansFromEventPairs(events: EventRecord[], config: SpanPairConfig): TraceSpan[] {
  const spans: TraceSpan[] = [];

  for (const start of events) {
    if (start.type !== config.startType || !start.timestamp) continue;
    const end = findMatchingEndEvent(events, start, config.endTypes, config.match);
    spans.push({
      id: `span:event:${start.id}`,
      traceId: start.traceId,
      sessionId: start.sessionId,
      turnId: start.turnId,
      spanId: start.spanId ?? end?.spanId,
      parentSpanId: start.parentSpanId ?? end?.parentSpanId,
      toolCallId: eventToolCallId(start.payload) ?? eventToolCallId(end?.payload),
      lane: config.lane,
      label: config.label(start),
      source: "eventlog",
      startAt: start.timestamp,
      endAt: end?.timestamp,
      status: spanStatusFromEndEvent(end),
      summary: end ? summarizeEvent(end) : summarizeEvent(start),
      payload: {
        start: eventPayloadForSpan(start),
        end: end ? eventPayloadForSpan(end) : undefined,
      },
    });
  }

  return spans;
}

export function eventPayloadForSpan(event: EventRecord): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };
}

export function findMatchingEndEvent(
  events: EventRecord[],
  start: EventRecord,
  endTypes: string[],
  match: (start: EventRecord, end: EventRecord) => boolean,
): EventRecord | undefined {
  const startAt = start.timestamp ?? "";
  return events.find((event) => {
    if (!endTypes.includes(event.type)) return false;
    if (startAt && event.timestamp && event.timestamp < startAt) return false;
    return match(start, event);
  });
}

export function matchTurnEvents(start: EventRecord, end: EventRecord): boolean {
  return matchSessionTurn(start, end);
}

export function matchModelEvents(start: EventRecord, end: EventRecord): boolean {
  const startId = eventCorrelationId(start.payload, ["modelRequestId", "requestId", "id"]);
  const endId = eventCorrelationId(end.payload, ["modelRequestId", "requestId", "id"]);
  if (startId && endId) return startId === endId;
  return matchSessionTurn(start, end);
}

export function matchToolEvents(start: EventRecord, end: EventRecord): boolean {
  const startToolCallId = eventToolCallId(start.payload);
  const endToolCallId = eventToolCallId(end.payload);
  if (startToolCallId && endToolCallId) return startToolCallId === endToolCallId;
  return matchSessionTurn(start, end);
}

export function matchPermissionEvents(start: EventRecord, end: EventRecord): boolean {
  const startPermissionId = eventCorrelationId(start.payload, ["permissionId", "requestId"]);
  const endPermissionId = eventCorrelationId(end.payload, ["permissionId", "requestId"]);
  if (startPermissionId && endPermissionId) return startPermissionId === endPermissionId;
  return matchToolEvents(start, end);
}

export function matchSubagentEvents(start: EventRecord, end: EventRecord): boolean {
  const startSubagentId = eventCorrelationId(start.payload, [
    "subagentId",
    "subagentSessionId",
    "childSessionId",
    "sessionId",
  ]);
  const endSubagentId = eventCorrelationId(end.payload, [
    "subagentId",
    "subagentSessionId",
    "childSessionId",
    "sessionId",
  ]);
  if (startSubagentId && endSubagentId) return startSubagentId === endSubagentId;
  return matchSessionTurn(start, end);
}

export function matchSessionTurn(start: EventRecord, end: EventRecord): boolean {
  if (start.sessionId && end.sessionId && start.sessionId !== end.sessionId) return false;
  if (start.turnId && end.turnId && start.turnId !== end.turnId) return false;
  return true;
}

export function eventCorrelationId(
  payload: Record<string, unknown> | undefined,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = stringValue(payload?.[name]);
    if (value) return value;
  }
  return undefined;
}

export function spanStatusFromEndEvent(event: EventRecord | undefined): TraceSpanStatus {
  if (!event) return "unknown";
  if (event.type.endsWith("_error") || event.type === "permission_denied") return "error";
  if (event.type.endsWith("_cancelled") || event.type.endsWith("_canceled")) return "cancelled";
  return "ok";
}

export function spanLaneFromLog(log: LogRecord): TraceSpanLane {
  const subject = `${log.event ?? ""} ${log.module ?? ""} ${log.message ?? ""}`.toLowerCase();
  if (subject.includes("tool")) return "tool";
  if (subject.includes("model") || subject.includes("provider")) return "model";
  if (subject.includes("permission") || subject.includes("approval")) return "permission";
  if (subject.includes("subagent")) return "subagent";
  if (subject.includes("network") || subject.includes("http")) return "network";
  if (subject.includes("sqlite") || subject.includes("storage") || subject.includes("cache")) {
    return "storage";
  }
  if (subject.includes("turn")) return "turn";
  return "log";
}

export function spanStatusFromLog(log: LogRecord): TraceSpanStatus {
  const normalized = log.status?.toLowerCase();
  if (normalized === "running" || normalized === "pending") return "running";
  if (normalized === "ok" || normalized === "success" || normalized === "completed") return "ok";
  if (normalized === "error" || normalized === "failed" || normalized === "failure") return "error";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "aborted") {
    return "cancelled";
  }
  if (log.level === "error") return "error";
  return "unknown";
}

export function subtractMs(value: string, durationMs: number): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return new Date(time - durationMs).toISOString();
}

export function summarizeDbMessage(message: DbMessageRecord): string {
  const text = stringValue(message.data.text) ?? stringValue(message.data.content);
  const title = `${formatRole(message.role)}消息 ${message.id}`;
  return text ? `${title}: ${text}` : title;
}

export function summarizeDbPart(part: DbPartRecord): string {
  const text = stringValue(part.data.text) ?? stringValue(part.data.output);
  return text ? `${part.type ?? "片段"}: ${text}` : `${part.type ?? "片段"} ${part.id}`;
}

export function eventToolName(payload?: Record<string, unknown>): string | undefined {
  return stringValue(payload?.toolName) ?? stringValue(payload?.name);
}

export function subagentLabel(event: EventRecord): string {
  return (
    stringValue(event.payload?.name) ??
    stringValue(event.payload?.subagentId) ??
    stringValue(event.payload?.subagentSessionId) ??
    "子 Agent"
  );
}
