import {
  mycodeApiRetryFromModelNetworkStatusPayload,
  mycodeApiRetryFromStreamRecoveryPayload,
  type MyCodeSessionTodoGroup,
} from "@mycode/shared";
import {
  SessionEventType,
  type PendingPermission,
  type SessionEvent,
  type TodoItem,
} from "@mycode/contracts";
import {
  buildProtocolPermissionOptions,
  toLegacyPermissionOptionsPolicy,
} from "./permission-options.js";
import {
  asRecord,
  stringValue,
  normalizeTodoContent,
} from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";
import { mapTodoItem } from "./session-mapper-map-todo-item.js";

export function mapSessionEventPayload(event: SessionEvent): unknown {
  const payload = event.payload;
  switch (event.type) {
    case SessionEventType.ModelRequest:
      return mapModelRequestPayload(payload);
    case SessionEventType.ModelNetworkStatus:
      return mapModelNetworkStatusPayload(payload);
    case SessionEventType.StreamRecoveryAnchorCreated:
    case SessionEventType.StreamRecoveryStarted:
    case SessionEventType.StreamRecoveryAnchorSelected:
    case SessionEventType.StreamRecoveryRetryStarted:
    case SessionEventType.StreamRecoveryTailDiscarded:
    case SessionEventType.StreamRecoveryBlocked:
      return mapStreamRecoveryPayload(payload);
    case SessionEventType.ToolCallScheduled:
      return { ...(payload as Record<string, unknown>), kind: "scheduled" };
    case SessionEventType.ToolCallStarted:
      return mapToolCallStartedPayload(payload, event.timestamp);
    case SessionEventType.ToolCallProgress:
      return { ...(payload as Record<string, unknown>), kind: "progress" };
    case SessionEventType.ToolCallResult:
      return { ...(payload as Record<string, unknown>), kind: "result" };
    case SessionEventType.ToolCallError:
      return { ...(payload as Record<string, unknown>), kind: "error" };
    case SessionEventType.ToolBatchComplete:
      return { ...(payload as Record<string, unknown>), kind: "batch" };
    case SessionEventType.PermissionRequested:
      return mapPermissionRequestedPayload(payload);
    case SessionEventType.PermissionDenied:
      return mapPermissionDeniedPayload(payload);
    default:
      return payload;
  }
}

export function mapPermissionDeniedPayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  return {
    ...record,
    // PermissionDenied 复用 permission.resolved 协议事件。
    // 下游投影依赖 decision=deny 才会把已出现的工具卡收口成失败态。
    decision: "deny",
  };
}

export function mapToolCallStartedPayload(
  payload: unknown,
  eventTimestamp: Date,
): Record<string, unknown> {
  const record = asRecord(payload);
  return {
    ...record,
    // ToolCallStarted 的 startedAt 来自 runtime Date 对象；协议跨进程后必须是
    // 稳定 JSON 值，否则接收侧 strict schema 会把 started 事件当成无效消息丢弃。
    startedAt: protocolInstantValue(record.startedAt) ?? eventTimestamp.getTime(),
    kind: "started",
  };
}

export function protocolInstantValue(value: unknown): number | string | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

export function mapModelRequestPayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const result: Record<string, unknown> = {
    messageCount: messages.length,
  };
  for (const key of [
    "providerId",
    "modelId",
    "temperature",
    "maxTokens",
    "toolCount",
    "iteration",
  ]) {
    if (record[key] !== undefined) {
      result[key] = record[key];
    }
  }
  // model_request 的 messages 是发给模型的完整上下文，只用于 core 内部追踪。
  // 之前映射成 session.updated 后会把全量上下文反复推给桌面，工具轮次越多单包越大。
  return result;
}

export function mapModelNetworkStatusPayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const apiRetry = mycodeApiRetryFromModelNetworkStatusPayload(record);
  if (apiRetry === undefined) {
    return record;
  }
  const meta = asRecord(record._meta);
  const mycodeMeta = asRecord(meta.mycode);
  return {
    ...record,
    _meta: {
      ...meta,
      mycode: {
        ...mycodeMeta,
        // 网络重试是模型请求运行态，不属于可持久化消息内容。
        // 这里通过 app 私有 meta 暴露给旧 task 投影，app 再写入 host runtime snapshot。
        apiRetry,
      },
    },
  };
}

export function mapStreamRecoveryPayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const apiRetry = mycodeApiRetryFromStreamRecoveryPayload(record);
  if (apiRetry === undefined) {
    return record;
  }
  const meta = asRecord(record._meta);
  const mycodeMeta = asRecord(meta.mycode);
  return {
    ...record,
    _meta: {
      ...meta,
      mycode: {
        ...mycodeMeta,
        // streamRecovery.updated 才是 SSE 断流恢复的核心进度事件。
        // 之前只在后续 model_request_started 上补 meta，UI 错过该事件时不会显示重试次数。
        apiRetry,
      },
    },
  };
}

export function mapPermissionRequestedPayload(payload: unknown): Record<string, unknown> {
  // 同 mapPendingPermission：这个 payload 是整体 spread 出去的，新字段必须在这里显式解构
  // 剔除，否则会直接漏进 strict 的 mycodePermissionRequestedEventPayloadSchema。
  const { display: _display, optionsPolicy, ...record } = asRecord(payload);
  const toolName = stringValue(record.toolName) ?? "unknown";
  return {
    ...record,
    options: buildProtocolPermissionOptions({
      input: record.input,
      suggestedPermissionUpdates: Array.isArray(record.suggestedPermissionUpdates)
        ? (record.suggestedPermissionUpdates as PendingPermission["suggestedPermissionUpdates"])
        : undefined,
      optionsPolicy: toLegacyPermissionOptionsPolicy(optionsPolicy),
      toolName,
    }),
  };
}

export function ensureTodoGroup(
  groups: Map<string, MyCodeSessionTodoGroup>,
  input: {
    goalIteration: number | undefined;
    groupId: string;
    startedAt: number;
    targetId?: string;
    updatedAt: number;
  },
): MyCodeSessionTodoGroup {
  const existing = groups.get(input.groupId);
  if (existing) {
    existing.updatedAt = Math.max(existing.updatedAt ?? 0, input.updatedAt);
    return existing;
  }
  const group: MyCodeSessionTodoGroup = {
    id: input.groupId,
    source: input.goalIteration ? "goal_iteration" : "session",
    ...(input.goalIteration ? { goalIteration: input.goalIteration } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    todos: [],
  };
  groups.set(input.groupId, group);
  return group;
}

export function addOrUpdateTodoInGroup(
  group: MyCodeSessionTodoGroup,
  fingerprint: string,
  todo: TodoItem,
): void {
  const nextTodo = mapTodoItem(todo);
  const existingIndex = group.todos.findIndex(
    (item) => normalizeTodoContent(item.content) === fingerprint,
  );
  if (existingIndex >= 0) {
    group.todos[existingIndex] = nextTodo;
    return;
  }
  group.todos.push(nextTodo);
}
