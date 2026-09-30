import type {
  ContextSectionSource,
  ContextSectionView,
  ContextSnapshotView,
  TraceSpan,
} from "../src/shared.js";
import { isRecord, numberValue, stringValue } from "./sources.js";
import type { LoadedObservation, LogRecord } from "./types.js";
import { spanLaneFromLog, subtractMs, spanStatusFromLog } from "./analyzer-build-timeline.js";
import { arrayValue, compareIsoAsc, preview } from "./analyzer-default-trace-limit.js";
import { modelName } from "./analyzer-list-traces.js";

export function spanFromLog(log: LogRecord): TraceSpan | undefined {
  if (!log.timestamp || log.durationMs === undefined || log.durationMs <= 0) return undefined;
  const lane = spanLaneFromLog(log);
  const endAt = log.timestamp;
  return {
    id: `span:log:${log.sourcePath}:${log.line}`,
    traceId: log.traceId,
    sessionId: log.sessionId,
    turnId: log.turnId,
    spanId: log.spanId,
    parentSpanId: log.parentSpanId,
    toolCallId: log.toolCallId,
    lane,
    label: log.event ?? log.message ?? "结构化日志",
    source: "log",
    startAt: subtractMs(endAt, log.durationMs),
    endAt,
    status: spanStatusFromLog(log),
    summary: log.message ?? log.event,
    payload: log.context ?? log.error,
  };
}

export function buildContextSnapshots(
  traceId: string,
  observation: LoadedObservation,
): ContextSnapshotView[] {
  const snapshots: ContextSnapshotView[] = [];

  for (const event of observation.events.records) {
    if (event.traceId !== traceId || event.type !== "model_request") continue;
    const messages = arrayValue(event.payload?.messages).filter(isRecord);
    const systemMessage = messages.find((message) => message.role === "system");
    const systemPrompt = stringValue(systemMessage?.content);
    const sections = systemPrompt
      ? deriveSectionsFromSystemPrompt(systemPrompt)
      : sectionsFromPayload(event.payload);
    snapshots.push(
      finalizeContextSnapshot({
        id: `event:${event.id}:context`,
        at: event.timestamp,
        traceId: event.traceId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        model: modelName(event.payload),
        messageCount: messages.length,
        sections,
        systemPrompt,
        observationLevel: systemPrompt ? "full" : sections.length > 0 ? "metadata" : "inferred",
        warnings: systemPrompt ? [] : ["当前数据源里的 model_request 没有完整 system prompt。"],
      }),
    );
  }

  for (const log of observation.logs.records) {
    if (log.traceId !== traceId || !isContextBuiltLog(log)) continue;
    const sections = sectionsFromContextBuiltLog(log);
    const hasFullContent = sections.some((section) => section.content);
    snapshots.push(
      finalizeContextSnapshot({
        id: `log:${log.sourcePath}:${log.line}:context`,
        at: log.timestamp,
        traceId: log.traceId,
        sessionId: log.sessionId,
        turnId: log.turnId,
        messageCount: 0,
        sections,
        observationLevel: hasFullContent ? "full" : "metadata",
        warnings: hasFullContent
          ? []
          : ["结构化日志只包含 section 元数据，没有完整 section 文本。"],
      }),
    );
  }

  return snapshots.sort((left, right) => compareIsoAsc(left.at, right.at));
}

export function finalizeContextSnapshot(
  input: Omit<ContextSnapshotView, "totalChars" | "totalTokens">,
): ContextSnapshotView {
  const totalTokens = input.sections.reduce((sum, section) => sum + section.tokens, 0);
  const totalChars = input.sections.reduce((sum, section) => sum + section.chars, 0);
  const sections = input.sections.map((section) => ({
    ...section,
    percentTokens: totalTokens > 0 ? section.tokens / totalTokens : 0,
  }));
  return {
    ...input,
    totalChars,
    totalTokens,
    sections,
  };
}

export function deriveSectionsFromSystemPrompt(systemPrompt: string): ContextSectionView[] {
  const matches = [...systemPrompt.matchAll(/^(#{1,2})\s+(.+)$/gm)];
  if (matches.length === 0) {
    return [
      makeSection({
        id: "system-prompt",
        name: "系统提示",
        source: "system_prompt",
        content: systemPrompt,
        observable: "full",
      }),
    ];
  }

  const sections: ContextSectionView[] = [];
  const firstIndex = matches[0]?.index ?? 0;
  if (firstIndex > 0) {
    const preamble = systemPrompt.slice(0, firstIndex).trim();
    if (preamble.length > 0) {
      sections.push(
        makeSection({
          id: "preamble",
          name: "系统提示",
          source: "system_prompt",
          content: preamble,
          observable: "full",
        }),
      );
    }
  }

  for (const [index, match] of matches.entries()) {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? systemPrompt.length;
    const name = match[2]?.trim() ?? "段落";
    const content = systemPrompt.slice(start, end).trim();
    sections.push(
      makeSection({
        id: slug(`${index}-${name}`),
        name,
        source: categorizeSection(name),
        content,
        observable: "full",
      }),
    );
  }

  return sections;
}

export function sectionsFromPayload(payload?: Record<string, unknown>): ContextSectionView[] {
  const snapshot = isRecord(payload?.contextSnapshot) ? payload.contextSnapshot : undefined;
  const rawSections = arrayValue(snapshot?.sections).filter(isRecord);
  return rawSections.map((section, index) => sectionFromMetadata(section, `payload-${index}`));
}

export function sectionsFromContextBuiltLog(log: LogRecord): ContextSectionView[] {
  const rawSections = arrayValue(log.context?.sections).filter(isRecord);
  return rawSections.map((section, index) => sectionFromMetadata(section, `log-${index}`));
}

export function sectionFromMetadata(
  section: Record<string, unknown>,
  fallbackId: string,
): ContextSectionView {
  const name = stringValue(section.name) ?? fallbackId;
  const preview = stringValue(section.preview);
  return {
    id: stringValue(section.id) ?? slug(name),
    name,
    source: categorizeSection(stringValue(section.source) ?? name),
    chars: numberValue(section.chars) ?? preview?.length ?? 0,
    tokens: numberValue(section.tokens) ?? estimateTokens(preview ?? ""),
    percentTokens: 0,
    preview,
    content: stringValue(section.content),
    observable: stringValue(section.content) ? "full" : "metadata",
  };
}

export function makeSection(input: {
  id: string;
  name: string;
  source: ContextSectionSource;
  content: string;
  observable: "full" | "metadata" | "inferred";
}): ContextSectionView {
  return {
    id: input.id,
    name: input.name,
    source: input.source,
    chars: input.content.length,
    tokens: estimateTokens(input.content),
    percentTokens: 0,
    preview: preview(input.content),
    content: input.content,
    observable: input.observable,
  };
}

export function isContextBuiltLog(log: LogRecord): boolean {
  return log.message === "Context built" || log.event === "context.built";
}

export function isContextUsageSnapshotLog(log: LogRecord): boolean {
  return log.message === "Context usage snapshot" || log.event === "context_usage_snapshot";
}

export function categorizeSection(nameOrSource: string): ContextSectionSource {
  const normalized = nameOrSource.toLowerCase();
  if (normalized.includes("skill") || normalized.includes("技能")) return "skills";
  if (normalized.includes("tool") || normalized.includes("工具")) return "tools";
  if (
    normalized.includes("identity") ||
    normalized.includes("system") ||
    normalized.includes("instruction") ||
    normalized.includes("env") ||
    normalized.includes("project") ||
    normalized.includes("prompt") ||
    normalized.includes("user_instructions") ||
    normalized.includes("project_context")
  ) {
    return "system_prompt";
  }
  return "other";
}

export function estimateTokens(text: string): number {
  const chineseChars = text.match(/[一-鿿]/g)?.length ?? 0;
  const otherChars = text.length - chineseChars;
  return Math.ceil((chineseChars * 2 + otherChars) / 3);
}

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}
