import { basename } from "node:path";
import type { ProjectSummary, SourceStatus, TraceSummary } from "../src/shared.js";
import {
  isRecord,
  loadEventLog,
  loadLogs,
  loadSqlite,
  numberValue,
  stringValue,
} from "./sources.js";
import type {
  DbMessageRecord,
  DbObservation,
  DbPartRecord,
  EventRecord,
  LoadedObservation,
  ObservationOptions,
  SourceLoadResult,
} from "./types.js";

export const DEFAULT_TRACE_LIMIT = 10;

export type TraceSummaryDraft = TraceSummary & {
  firstUserMessageAt?: string;
};

export async function loadObservation(options: ObservationOptions): Promise<LoadedObservation> {
  const [logs, events] = await Promise.all([loadLogs(options), loadEventLog(options)]);
  return {
    logs,
    events,
    db: loadSqlite(options),
  };
}

export function sourceStatuses(observation: LoadedObservation): SourceStatus[] {
  return [
    toSourceStatus(observation.logs),
    toSourceStatus(observation.events),
    toSourceStatus(observation.db),
  ];
}

export function toSourceStatus<TRecord>(source: SourceLoadResult<TRecord>): SourceStatus {
  return {
    kind: source.kind,
    label: source.label,
    path: source.path,
    available: source.records.length > 0,
    recordCount: source.records.length,
    warning: source.warning,
  };
}

export function buildProjectSummaries(db?: DbObservation): ProjectSummary[] {
  if (!db) return [];
  const byProject = new Map<string, ProjectSummary>();

  for (const session of db.sessions) {
    const existing = byProject.get(session.projectId);
    if (!existing) {
      byProject.set(session.projectId, {
        projectId: session.projectId,
        label: projectLabel(session.directory),
        directory: session.directory,
        sessionCount: 1,
        updatedAt: session.updatedAt,
      });
      continue;
    }

    existing.sessionCount += 1;
    if (!existing.updatedAt || (session.updatedAt && session.updatedAt > existing.updatedAt)) {
      existing.updatedAt = session.updatedAt;
      existing.directory = session.directory;
      existing.label = projectLabel(session.directory);
    }
  }

  return [...byProject.values()].sort((left, right) =>
    compareIsoDesc(left.updatedAt, right.updatedAt),
  );
}

export function sessionIdsForProject(
  db: DbObservation | undefined,
  projectId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const session of db?.sessions ?? []) {
    if (session.projectId === projectId) ids.add(session.id);
  }
  return ids;
}

export function projectLabel(directory: string): string {
  return basename(directory) || directory || "未命名项目";
}

export function ensureTraceSummary(
  summaries: Map<string, TraceSummaryDraft>,
  traceId: string,
): TraceSummaryDraft {
  const existing = summaries.get(traceId);
  if (existing) return existing;
  const summary: TraceSummary = {
    traceId,
    sessionIds: [],
    eventCount: 0,
    logCount: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  summaries.set(traceId, summary);
  return summary;
}

export function groupPartsByMessageId(parts: DbPartRecord[]): Map<string, DbPartRecord[]> {
  const byMessageId = new Map<string, DbPartRecord[]>();
  for (const part of parts) {
    const existing = byMessageId.get(part.messageId);
    if (existing) {
      existing.push(part);
    } else {
      byMessageId.set(part.messageId, [part]);
    }
  }
  return byMessageId;
}

export function recordFirstUserMessage(
  summary: TraceSummaryDraft,
  text: string | undefined,
  at?: string,
): void {
  const normalized = text ? preview(text, 120) : undefined;
  if (!normalized) return;
  if (summary.firstUserMessageAt) {
    if (!at || compareIsoAsc(summary.firstUserMessageAt, at) <= 0) return;
  } else if (summary.firstUserMessage && !at) {
    return;
  }

  summary.firstUserMessage = normalized;
  summary.firstUserMessageAt = at;
}

export function addSession(summary: TraceSummary, sessionId?: string): void {
  if (sessionId && !summary.sessionIds.includes(sessionId)) {
    summary.sessionIds.push(sessionId);
  }
}

export function addTime(summary: TraceSummary, at?: string): void {
  if (!at) return;
  if (!summary.firstAt || at < summary.firstAt) summary.firstAt = at;
  if (!summary.lastAt || at > summary.lastAt) summary.lastAt = at;
}

export function extractUsage(payload?: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const usage = isRecord(payload?.usage) ? payload.usage : payload;
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }

  return {
    inputTokens: numberValue(usage.inputTokens) ?? numberValue(usage.input) ?? 0,
    outputTokens: numberValue(usage.outputTokens) ?? numberValue(usage.output) ?? 0,
    totalTokens: numberValue(usage.totalTokens) ?? numberValue(usage.total) ?? 0,
    cacheReadTokens:
      numberValue(usage.cacheReadTokens) ??
      numberValue(isRecord(usage.cache) ? usage.cache.read : undefined) ??
      0,
    cacheWriteTokens:
      numberValue(usage.cacheWriteTokens) ??
      numberValue(isRecord(usage.cache) ? usage.cache.write : undefined) ??
      0,
  };
}

export function firstUserMessageFromEvent(event: EventRecord): string | undefined {
  if (event.type === "user_message") {
    return textFromPayload(event.payload);
  }

  const messages = arrayValue(event.payload?.messages).filter(isRecord);
  const userMessage = messages.find((message) => stringValue(message.role) === "user");
  return userMessage ? textFromPayload(userMessage) : undefined;
}

export function textFromDbMessage(message: DbMessageRecord): string | undefined {
  return textFromPayload(message.data);
}

export function textFromDbParts(parts: DbPartRecord[] | undefined): string | undefined {
  const textParts = parts
    ?.map((part) => textFromPayload(part.data))
    .filter((text): text is string => Boolean(text?.trim()));
  if (!textParts || textParts.length === 0) return undefined;
  return textParts.join("\n");
}

export function textFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  return (
    textFromContent(payload.content) ??
    textFromContent(payload.text) ??
    textFromContent(payload.message)
  );
}

export function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        return textFromContent(part.text) ?? textFromContent(part.content) ?? "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (isRecord(content)) {
    return textFromContent(content.text) ?? textFromContent(content.content);
  }
  return undefined;
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function preview(text: string, maxLength = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

export function compareIsoAsc(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

export function compareIsoDesc(left?: string, right?: string): number {
  return compareIsoAsc(right, left);
}
