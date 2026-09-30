import { AlertTriangle, BarChart3 } from "lucide-react";
import type {
  DataGroup as VisTimelineGroup,
  DataItem as VisTimelineItem,
  TimelineOptions,
} from "vis-timeline/standalone";
import type { CacheReport, NetworkRequestRecord, TraceDetailResponse, TraceSpan } from "./shared";
import { ganttItemStyle } from "./gantt-style";
import { isRenderableCacheSegment, Metric } from "./App-timeline-panel.js";
import { PanelTitle, EmptyLine } from "./App-view-tabs.js";
import { laneOrder, laneLabels, formatNetworkStatus } from "./App-source-inputs.js";

export function CachePanel({ reports }: { reports: CacheReport[] }) {
  const report = reports.at(-1);
  const segments = report?.segments.filter(isRenderableCacheSegment) ?? [];

  return (
    <section className="panel cache-panel">
      <PanelTitle icon={<BarChart3 size={17} />} title="缓存" />
      {!report ? <EmptyLine text="未观察到缓存使用" /> : null}
      {report ? (
        <>
          <div className="metric-row">
            <Metric label="读取" value={report.cacheReadTokens.toLocaleString()} />
            <Metric label="写入" value={report.cacheWriteTokens.toLocaleString()} />
            <Metric
              label="命中"
              value={report.hitRate === null ? "未知" : `${Math.round(report.hitRate * 100)}%`}
            />
          </div>
          {segments.length > 0 ? (
            <div className="cache-segments">
              {segments.map((segment) => (
                <article className={`cache-segment ${segment.status}`} key={segment.id}>
                  <strong>{formatCacheStatus(segment.status)}</strong>
                  <span>{formatSegmentLabel(segment.role ?? segment.source)}</span>
                  <p>{segment.preview}</p>
                  {segment.reason ? <small>{segment.reason}</small> : null}
                </article>
              ))}
            </div>
          ) : null}
          {report.limitations.map((limitation) => (
            <p className="soft-warning" key={limitation}>
              {limitation}
            </p>
          ))}
        </>
      ) : null}
    </section>
  );
}

export function GapsPanel({ requests }: { requests: TraceDetailResponse["developerRequests"] }) {
  return (
    <section className="panel gaps-panel">
      <PanelTitle icon={<AlertTriangle size={17} />} title="观测缺口" />
      {requests.length === 0 ? <EmptyLine text="当前 trace 没有观测缺口" /> : null}
      {requests.map((request) => (
        <article className="request-row" key={request.eventName}>
          <strong>{request.title}</strong>
          <p>{request.reason}</p>
          <code>{request.eventName}</code>
        </article>
      ))}
    </section>
  );
}

export function buildGanttGroups(spans: TraceSpan[]): VisTimelineGroup[] {
  const activeLanes = new Set(spans.map((span) => span.lane));
  return laneOrder
    .filter((lane) => activeLanes.has(lane))
    .map((lane, index) => ({
      id: lane,
      content: laneLabels[lane],
      order: index,
      className: `gantt-group lane-${lane}`,
    }));
}

export function buildGanttItems(spans: TraceSpan[]): VisTimelineItem[] {
  return spans.map((span) => {
    const runningEndAt =
      !span.endAt && span.status === "running" ? new Date().toISOString() : undefined;
    const type = span.endAt || runningEndAt ? "range" : "point";
    return {
      id: span.id,
      group: span.lane,
      content: ganttItemContent(span),
      title: escapeTimelineContent(ganttItemTitle(span)),
      start: span.startAt,
      end: span.endAt ?? runningEndAt,
      type,
      style: ganttItemStyle(type),
      className: `gantt-item lane-${span.lane} span-status-${span.status}`,
    };
  });
}

export function ganttItemContent(span: TraceSpan): string {
  return [
    `<span class="gantt-item-title">${escapeTimelineContent(span.label)}</span>`,
    `<span class="gantt-item-meta"> · ${escapeTimelineContent(ganttItemMeta(span))}</span>`,
  ].join("");
}

export function ganttItemTitle(span: TraceSpan): string {
  return [
    span.label,
    `${laneLabels[span.lane]} · ${formatSpanStatus(span.status)} · ${formatSpanDuration(span)}`,
    ganttIdentifierLine(span),
    span.summary,
  ]
    .filter(Boolean)
    .join("\n");
}

export function ganttItemMeta(span: TraceSpan): string {
  const request = networkRequestFromPayload(span.payload);
  if (request) {
    return [formatNetworkStatus(request), formatDuration(request.durationMs)].join(" · ");
  }

  return [formatSpanStatus(span.status), formatSpanDuration(span)].join(" · ");
}

export function ganttIdentifierLine(span: TraceSpan): string {
  return [
    span.traceId ? `trace ${span.traceId}` : "",
    span.sessionId ? `session ${span.sessionId}` : "",
    span.turnId ? `turn ${span.turnId}` : "",
    span.toolCallId ? `tool ${span.toolCallId}` : "",
    span.spanId ? `span ${span.spanId}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function networkRequestFromPayload(payload: unknown): NetworkRequestRecord | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.id !== "string") return null;
  if (typeof payload.startedAt !== "string") return null;
  if (typeof payload.method !== "string") return null;
  if (typeof payload.url !== "string") return null;
  if (typeof payload.status !== "string") return null;
  return payload as unknown as NetworkRequestRecord;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function ganttOptions(isFullscreen: boolean): TimelineOptions {
  return {
    stack: true,
    autoResize: true,
    selectable: true,
    showCurrentTime: false,
    horizontalScroll: true,
    verticalScroll: true,
    zoomKey: "ctrlKey",
    orientation: { axis: "top", item: isFullscreen ? "top" : "bottom" },
    margin: { item: { horizontal: 8, vertical: 8 }, axis: 12 },
    groupHeightMode: "fitItems",
    height: isFullscreen ? "100%" : undefined,
    minHeight: isFullscreen ? "0" : "320px",
    maxHeight: isFullscreen ? undefined : "560px",
  };
}

export function escapeTimelineContent(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatSpanStatus(value: TraceSpan["status"]): string {
  switch (value) {
    case "running":
      return "进行中";
    case "ok":
      return "完成";
    case "error":
      return "错误";
    case "cancelled":
      return "已取消";
    case "unknown":
      return "未知";
  }
}

export function formatSpanDuration(span: TraceSpan): string {
  if (!span.endAt) return span.status === "running" ? "进行中" : "未结束";
  const start = new Date(span.startAt).getTime();
  const end = new Date(span.endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "未知耗时";
  return formatDuration(end - start);
}

export function formatCacheStatus(value: CacheReport["segments"][number]["status"]): string {
  switch (value) {
    case "hit":
      return "命中";
    case "miss":
      return "未命中";
    case "unknown":
      return "未知";
  }
}

export function formatSegmentLabel(value?: string): string {
  switch (value) {
    case "system_prompt":
      return "系统";
    case "skills":
      return "技能";
    case "tools":
      return "工具";
    case "other":
      return "其他";
    case "message":
      return "消息";
    case "system":
      return "system 消息";
    case "user":
      return "user 消息";
    case "assistant":
      return "assistant 消息";
    case "tool":
      return "tool 消息";
    default:
      return value ?? "片段";
  }
}

export function formatDuration(value?: number): string {
  if (value === undefined) return "-- ms";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function compareDateAsc(left?: string, right?: string): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}
