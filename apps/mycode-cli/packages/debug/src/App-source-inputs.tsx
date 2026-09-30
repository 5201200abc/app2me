import { useEffect, useState } from "react";
import type {
  ContextSectionSource,
  ContextUsageSource,
  NetworkCaptureStatus,
  NetworkRequestRecord,
  NetworkRequestsResponse,
  TraceSpan,
  TraceSpanLane,
} from "./shared";

export interface SourceInputs {
  projectId: string;
  logDir: string;
  eventPath: string;
  dbPath: string;
  sessionId: string;
}

export interface ObservationEventState {
  connected: boolean;
  error: string | null;
  lastChangeAt?: string;
  watchedPathCount: number;
}

export const emptyInputs: SourceInputs = {
  projectId: "",
  logDir: "",
  eventPath: "",
  dbPath: "",
  sessionId: "",
};

export const lastProjectStorageKey = "mycode-debug:last-project-id";

export type EnvShell = "posix" | "powershell" | "cmd";

export type DebugView = "trace" | "gantt" | "network";

export const envShellLabels: Record<EnvShell, string> = {
  posix: "POSIX",
  powershell: "PowerShell",
  cmd: "CMD",
};

export const viewLabels: Record<DebugView, string> = {
  trace: "Trace",
  gantt: "甘特图",
  network: "网络请求",
};

export const laneOrder: TraceSpanLane[] = [
  "turn",
  "model",
  "tool",
  "permission",
  "subagent",
  "network",
  "storage",
  "log",
  "event",
];

export const laneLabels: Record<TraceSpanLane, string> = {
  turn: "Turn",
  model: "模型",
  tool: "工具",
  network: "网络",
  permission: "权限",
  storage: "存储",
  subagent: "子 Agent",
  event: "事件",
  log: "日志",
};

export const sourceLabels: Record<ContextSectionSource, string> = {
  system_prompt: "系统",
  skills: "技能",
  tools: "工具",
  other: "其他",
};

export const sourceClasses: Record<ContextSectionSource, string> = {
  system_prompt: "tone-system",
  skills: "tone-skills",
  tools: "tone-tools",
  other: "tone-other",
};

export const usageSourceLabels: Record<ContextUsageSource, string> = {
  system_prompt: "系统提示",
  meta_user_context: "Meta User 上下文",
  skills: "技能",
  tool_prompt: "工具提示",
  system_tool_schemas: "系统工具",
  mcp_tool_schemas: "MCP 工具",
  messages: "消息",
  other: "其他",
};

export const usageSourceClasses: Record<ContextUsageSource, string> = {
  system_prompt: "tone-system",
  meta_user_context: "tone-meta-user",
  skills: "tone-skills",
  tool_prompt: "tone-tools",
  system_tool_schemas: "tone-tool-schema",
  mcp_tool_schemas: "tone-mcp",
  messages: "tone-messages",
  other: "tone-other",
};

export function useNetworkCapture(): {
  status: NetworkCaptureStatus | null;
  requests: NetworkRequestRecord[];
  error: string | null;
} {
  const [status, setStatus] = useState<NetworkCaptureStatus | null>(null);
  const [requests, setRequests] = useState<NetworkRequestRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;

    async function loadInitialState() {
      try {
        const response = await fetchJson<NetworkRequestsResponse>(
          "/api/network/requests?limit=200",
        );
        if (closed) return;
        setStatus(response.status);
        setRequests(response.requests);
      } catch (fetchError) {
        if (!closed)
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    }

    void loadInitialState();
    const events = new EventSource("/api/network/events");
    events.addEventListener("status", (event) => {
      const parsed = parseMessageEvent<NetworkCaptureStatus>(event);
      if (parsed && !closed) setStatus(parsed);
    });
    events.addEventListener("snapshot", (event) => {
      const parsed = parseMessageEvent<NetworkRequestRecord[]>(event);
      if (parsed && !closed) setRequests(parsed);
    });
    events.addEventListener("request", (event) => {
      const parsed = parseMessageEvent<NetworkRequestRecord>(event);
      if (parsed && !closed) {
        setRequests((current) => mergeNetworkRequest(current, parsed));
      }
    });
    events.addEventListener("reset", () => {
      if (!closed) setRequests([]);
    });
    events.addEventListener("error", () => {
      if (!closed) setError("网络抓包事件流已断开，正在等待浏览器重连。");
    });
    events.addEventListener("open", () => {
      if (!closed) setError(null);
    });

    return () => {
      closed = true;
      events.close();
    };
  }, []);

  return { status, requests, error };
}

export function buildQuery(inputs: SourceInputs): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(inputs)) {
    if (value.trim()) params.set(key, value.trim());
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function parseMessageEvent<T>(event: Event): T | null {
  const data = (event as MessageEvent<string>).data;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function mergeNetworkRequest(
  current: NetworkRequestRecord[],
  next: NetworkRequestRecord,
): NetworkRequestRecord[] {
  const byId = new Map(current.map((request) => [request.id, request]));
  byId.set(next.id, next);
  return [...byId.values()]
    .toSorted((left, right) => compareDateDesc(left.startedAt, right.startedAt))
    .slice(0, 200);
}

export function mergeNetworkSpans(
  spans: TraceSpan[],
  requests: NetworkRequestRecord[],
  traceId: string,
): TraceSpan[] {
  if (!traceId) return spans;
  const networkSpans = requests
    .filter((request) => request.traceId === traceId)
    .map(networkRequestToSpan);
  return [...spans, ...networkSpans];
}

export function networkRequestToSpan(request: NetworkRequestRecord): TraceSpan {
  return {
    id: `network:${request.id}`,
    traceId: request.traceId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    spanId: request.spanId,
    lane: "network",
    label: `${request.method} ${request.host}`,
    source: "network",
    startAt: request.startedAt,
    endAt: request.completedAt,
    status: request.status === "pending" ? "running" : request.status === "error" ? "error" : "ok",
    summary: `${request.method} ${request.url}\n${formatNetworkStatus(request)} · ${formatBytes(
      request.requestBodyBytes,
    )} up · ${formatBytes(request.responseBodyBytes)} down`,
    payload: request,
  };
}

export function viewFromHash(hash: string): DebugView {
  const normalized = hash.replace(/^#/, "");
  if (normalized === "gantt" || normalized === "network") return normalized;
  return "gantt";
}

export function formatNetworkStatus(request: NetworkRequestRecord): string {
  if (request.status === "pending") return "进行中";
  if (request.status === "error") return "错误";
  return request.statusCode ? String(request.statusCode) : "完成";
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function compareDateDesc(left?: string, right?: string): number {
  return new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime();
}
