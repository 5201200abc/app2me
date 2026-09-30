import type { TraceDetailResponse, TraceSpan } from "../src/shared.js";
import type { LoadedObservation, ObservationOptions } from "./types.js";
import { loadObservation, sourceStatuses, compareIsoAsc } from "./analyzer-default-trace-limit.js";
import { collectSessionsForTrace, modelName, eventToolCallId } from "./analyzer-list-traces.js";
import {
  buildTimeline,
  spansFromEventPairs,
  matchTurnEvents,
  matchModelEvents,
  eventToolName,
  matchToolEvents,
  matchPermissionEvents,
  subagentLabel,
  matchSubagentEvents,
} from "./analyzer-build-timeline.js";
import { buildContextSnapshots, spanFromLog } from "./analyzer-span-from-log.js";
import { buildContextUsageSnapshots } from "./analyzer-build-context-usage-snapshots.js";
import { buildCacheReports, buildDeveloperRequests } from "./analyzer-build-cache-reports.js";

export async function inspectTrace(
  traceId: string,
  options: ObservationOptions = {},
): Promise<TraceDetailResponse> {
  const observation = await loadObservation({ ...options, traceId });
  const sessions = collectSessionsForTrace(traceId, observation, options.sessionId);
  const timeline = buildTimeline(traceId, sessions, observation);
  const spans = buildTraceSpans(traceId, sessions, observation);
  const contextSnapshots = buildContextSnapshots(traceId, observation);
  const contextUsageSnapshots = buildContextUsageSnapshots(traceId, sessions, observation);
  const cacheReports = buildCacheReports(traceId, sessions, observation);

  return {
    traceId,
    sessions: [...sessions].sort(),
    sources: sourceStatuses(observation),
    timeline,
    spans,
    contextSnapshots,
    contextUsageSnapshots,
    cacheReports,
    developerRequests: buildDeveloperRequests(observation, contextSnapshots, cacheReports),
  };
}

function buildTraceSpans(
  traceId: string,
  _sessions: Set<string>,
  observation: LoadedObservation,
): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const traceEvents = observation.events.records
    .filter((event) => event.traceId === traceId)
    .sort((left, right) => compareIsoAsc(left.timestamp, right.timestamp));

  spans.push(
    ...spansFromEventPairs(traceEvents, {
      lane: "turn",
      startType: "turn_started",
      endTypes: ["turn_complete", "turn_error"],
      label: (event) => `Turn ${event.turnId ?? event.sessionId ?? event.id}`,
      match: matchTurnEvents,
    }),
    ...spansFromEventPairs(traceEvents, {
      lane: "model",
      startType: "model_request",
      endTypes: ["model_complete", "model_error"],
      label: (event) => modelName(event.payload) ?? "模型请求",
      match: matchModelEvents,
    }),
    ...spansFromEventPairs(traceEvents, {
      lane: "tool",
      startType: "tool_call_started",
      endTypes: ["tool_call_result", "tool_call_error"],
      label: (event) =>
        eventToolName(event.payload) ?? eventToolCallId(event.payload) ?? "工具调用",
      match: matchToolEvents,
    }),
    ...spansFromEventPairs(traceEvents, {
      lane: "permission",
      startType: "permission_requested",
      endTypes: ["permission_resolved", "permission_denied"],
      label: (event) =>
        eventToolName(event.payload) ?? eventToolCallId(event.payload) ?? "权限请求",
      match: matchPermissionEvents,
    }),
    ...spansFromEventPairs(traceEvents, {
      lane: "subagent",
      startType: "subagent_spawned",
      endTypes: ["subagent_stopped"],
      label: (event) => subagentLabel(event),
      match: matchSubagentEvents,
    }),
  );

  for (const log of observation.logs.records) {
    if (log.traceId !== traceId) continue;
    const span = spanFromLog(log);
    if (span) spans.push(span);
  }

  return spans.sort((left, right) => compareIsoAsc(left.startAt, right.startAt));
}

export { listTraces } from "./analyzer-list-traces.js";
