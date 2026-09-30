import { getMyCodeGoalActiveIterationCount, type MyCodeSessionGoalStats } from "@mycode/shared";
import {
  type MessageWithParts,
  type SessionGoal,
  type SessionProjection,
  type TodoItem,
  type ToolState,
} from "@mycode/contracts";
import {
  getTargetGoalVerificationTimeline,
  compareMessagesByCreatedTime,
  compareGoalVerificationTimeline,
  asRecord,
  stringValue,
} from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";
import {
  type GoalIterationBucket,
  isPassingGoalVerification,
} from "./session-mapper-map-session-settings.js";

export function mapTodoItem(todo: TodoItem): TodoItem {
  return {
    content: todo.content,
    priority: todo.priority,
    status: todo.status,
  };
}

export function buildGoalStats(
  projection: SessionProjection,
  messages: readonly MessageWithParts[],
): MyCodeSessionGoalStats | undefined {
  const target = projection.target;
  if (!target) {
    return undefined;
  }
  const goalIterations = collectGoalIterationBuckets(messages, {
    projection,
    target,
  });
  const activeIterationCount = getGoalActiveIterationCount(projection, target);
  const derivedTokensUsed = goalIterations.reduce(
    (sum, iteration) => sum + iteration.tokensUsed,
    0,
  );
  const derivedTimeUsedSeconds = goalIterations.reduce(
    (sum, iteration) => sum + iteration.timeUsedSeconds,
    0,
  );
  return {
    contextUsed: projection.contextUsed,
    contextWindow: projection.contextWindow,
    // goal 轮次只能由 verifier 生命周期边界推进；用户消息、TodoWrite
    // 或手动继续都只是落入当前打开轮次，不能单独开新轮。
    iterationCount: activeIterationCount,
    // active goal run 已由 session_target.active_run_started_at 表达。
    // 运行中不能再用 assistant 消息推导出的时间当已结算 base，否则 UI 会再叠加 live run 导致切换恢复后双算。
    timeUsedSeconds:
      target.timeUsedSeconds > 0 || target.activeRunStartedAtMs != null
        ? target.timeUsedSeconds
        : derivedTimeUsedSeconds,
    // 旧 session_target 行可能没有 tokenBudget；协议 schema 需要稳定 JSON 值，
    // 与 mapSessionGoal 保持一致用 null 表示未设置预算。
    tokenBudget: target.tokenBudget ?? null,
    tokensUsed: target.tokensUsed > 0 ? target.tokensUsed : derivedTokensUsed,
    toolCallCount: goalIterations.reduce((sum, iteration) => sum + iteration.toolCallCount, 0),
  };
}

export function getGoalActiveIterationCount(
  projection: SessionProjection,
  target?: SessionGoal | null,
): number {
  const timeline = getTargetGoalVerificationTimeline(projection, target);
  return getMyCodeGoalActiveIterationCount({
    targetStatus: target?.status ?? null,
    timeline,
  });
}

export function collectGoalIterationBuckets(
  messages: readonly MessageWithParts[],
  options: { projection: SessionProjection; target?: SessionGoal | null },
): GoalIterationBucket[] {
  const target = options.target ?? null;
  const timeline = getTargetGoalVerificationTimeline(options.projection, target);
  const buckets: GoalIterationBucket[] = [];
  const byIteration = new Map<number, GoalIterationBucket>();
  const sortedMessages = [...messages].sort(compareMessagesByCreatedTime);

  for (const message of sortedMessages) {
    if (message.info.role !== "assistant") {
      continue;
    }
    const goalIteration = getGoalIterationForMessageTime(
      message.info.time.created,
      target,
      timeline,
    );
    if (!goalIteration) {
      continue;
    }
    const bucket =
      byIteration.get(goalIteration) ??
      createGoalIterationBucket(goalIteration, target, timeline, message.info.time.created);
    if (!byIteration.has(goalIteration)) {
      byIteration.set(goalIteration, bucket);
      buckets.push(bucket);
    }
    const messageId = String(message.info.id);
    bucket.messageIds.add(messageId);
    const completedAt = message.info.time.completed ?? message.info.time.created;
    bucket.toolCallCount += message.parts.filter((part) => part.type === "tool").length;
    bucket.tokensUsed += tokenTotal(message.info.tokens);
    bucket.timeUsedSeconds += Math.max(
      0,
      Math.ceil((completedAt - message.info.time.created) / 1000),
    );
    bucket.updatedAt = Math.max(bucket.updatedAt ?? 0, completedAt);
  }

  return buckets;
}

export function createGoalIterationBucket(
  goalIteration: number,
  target: SessionGoal | null,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
  fallbackStartedAt: number,
): GoalIterationBucket {
  return {
    goalIteration,
    id: `goal-iteration-${goalIteration}`,
    messageIds: new Set(),
    startedAt: getGoalIterationStartedAt(goalIteration, target, timeline, fallbackStartedAt),
    targetId: target?.targetID,
    toolCallCount: 0,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    updatedAt: fallbackStartedAt,
  };
}

export function getGoalIterationForMessageTime(
  messageCreatedAt: number,
  target: SessionGoal | null | undefined,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
): number | undefined {
  if (!target || messageCreatedAt < target.time.created) {
    return undefined;
  }
  let activeIteration = 1;
  for (const item of timeline) {
    const itemIteration = item.goalIteration ?? activeIteration;
    const boundaryTime = item.updatedAt.getTime();
    if (messageCreatedAt <= boundaryTime) {
      return itemIteration;
    }
    if (item.status === "started") {
      activeIteration = itemIteration;
      continue;
    }
    if (isPassingGoalVerification(item)) {
      return undefined;
    }
    activeIteration = itemIteration + 1;
  }
  return activeIteration;
}

export function getGoalIterationStartedAt(
  goalIteration: number,
  target: SessionGoal | null | undefined,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
  fallbackStartedAt: number,
): number {
  if (!target || goalIteration <= 1) {
    return target?.time.created ?? fallbackStartedAt;
  }
  const previousBoundary = [...timeline]
    .filter((item) => (item.goalIteration ?? 0) === goalIteration - 1)
    .filter((item) => item.status !== "started")
    .sort(compareGoalVerificationTimeline)
    .at(-1);
  return previousBoundary?.updatedAt.getTime() ?? fallbackStartedAt;
}

export function readTodosFromToolInput(input: Record<string, unknown>): TodoItem[] | undefined {
  const rawTodos = input.todos;
  if (!Array.isArray(rawTodos)) {
    return undefined;
  }
  const todos = rawTodos.map(readTodoItem).filter((todo): todo is TodoItem => todo !== null);
  return todos.length === rawTodos.length ? todos : undefined;
}

export function readTodoItem(value: unknown): TodoItem | null {
  const record = asRecord(value);
  const content = stringValue(record.content)?.trim();
  const status = stringValue(record.status);
  const priority = stringValue(record.priority);
  if (!content || !isTodoStatus(status) || !isTodoPriority(priority)) {
    return null;
  }
  return { content, priority, status };
}

export function isTodoWriteToolName(toolName: string): boolean {
  return toolName.toLowerCase().replace(/[_\s-]/g, "") === "todowrite";
}

export function readToolStateMetadata(state: ToolState): Record<string, unknown> | undefined {
  switch (state.status) {
    case "pending":
      return undefined;
    case "running":
    case "completed":
    case "error":
      return state.metadata;
  }
}

export function isTodoStatus(status: string | undefined): status is TodoItem["status"] {
  return status === "pending" || status === "in_progress" || status === "completed";
}

export function isTodoPriority(priority: string | undefined): priority is TodoItem["priority"] {
  return priority === "high" || priority === "medium" || priority === "low";
}

export function readToolStateUpdatedAt(state: ToolState): number | undefined {
  if (state.status === "completed" || state.status === "error") {
    return state.time.end;
  }
  if (state.status === "running") {
    return state.time.start;
  }
  return undefined;
}

export function tokenTotal(tokens: {
  cache: { read: number; write: number };
  input: number;
  output: number;
  reasoning: number;
  total?: number;
}): number {
  return (
    tokens.total ??
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  );
}
