import {
  MYCODE_PROTOCOL_NAME,
  MYCODE_PROTOCOL_VERSION,
  type MyCodeDeliveryKind,
  type MyCodeSessionStateSnapshot,
  type MyCodeSessionTodoGroup,
  type MyCodeWorkspaceRef,
  isMainAgentToolProjectionSource,
} from "@mycode/shared";
import {
  type MessageWithParts,
  type SessionEvent,
  type SessionGoal,
  type SessionInfo,
  type SessionProjection,
  type TodoItem,
} from "@mycode/contracts";
import type { MyCodeApp } from "../app/types.js";
import {
  listProtocolSlashCommands,
  type ListProtocolSlashCommandsOptions,
} from "./slash-commands.js";
import {
  mergePersistedGoalVerificationEvents,
  withGoalSummaryTitleFallback,
  mapSnapshotMessages,
  getTargetGoalVerificationTimeline,
  compareMessagesByCreatedTime,
  normalizeTodoContent,
} from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";
import { mapSessionProjection } from "./session-mapper-map-session-projection.js";
import {
  mapRuntimeState,
  mapSessionInfo,
  mapSessionSettings,
} from "./session-mapper-map-session-settings.js";
import {
  buildGoalStats,
  mapTodoItem,
  getGoalIterationForMessageTime,
  isTodoWriteToolName,
  readToolStateMetadata,
  readTodosFromToolInput,
  readToolStateUpdatedAt,
  getGoalIterationStartedAt,
} from "./session-mapper-map-todo-item.js";
import {
  ensureTodoGroup,
  addOrUpdateTodoInGroup,
} from "./session-mapper-map-session-event-payload.js";

export async function buildSessionSnapshot(input: {
  app: MyCodeApp;
  deliveryKind?: MyCodeDeliveryKind;
  eventSeq: number;
  fallbackCreatedAt?: number;
  fallbackUpdatedAt?: number;
  lastError?: SessionProjection["lastError"];
  messages: MessageWithParts[];
  modelAvailability?: "all" | "current";
  persistedGoalVerificationEvents?: SessionEvent[];
  persistedContextUsageBreakdownEvents?: SessionEvent[];
  session?: SessionInfo | null;
  stateRevision: number;
  slashCommandOptions?: ListProtocolSlashCommandsOptions;
  target?: SessionGoal | null;
  todos?: TodoItem[];
  workspace: MyCodeWorkspaceRef;
}): Promise<MyCodeSessionStateSnapshot> {
  const runtimeProjection = await input.app.runtime.getProjection();
  const activeTurn = input.app.runtime.getActiveTurnInfo();
  const persistedGoalProjection = mergePersistedGoalVerificationEvents(
    runtimeProjection,
    input.persistedGoalVerificationEvents ?? [],
    input.target === undefined ? runtimeProjection.target : input.target,
  );
  // runtime projection 是运行期 eventStore reducer，恢复历史 session 时可能没有
  // target_changed 账本；session_target 表才是 goal 权威状态，snapshot 必须以 DB 读取值为准。
  const projectionWithoutTitleFallback =
    input.target === undefined && input.lastError === undefined
      ? persistedGoalProjection
      : {
          ...persistedGoalProjection,
          ...(input.target === undefined ? {} : { target: input.target }),
          ...(input.lastError === undefined ? {} : { lastError: input.lastError }),
        };
  const projection = withGoalSummaryTitleFallback(
    projectionWithoutTitleFallback,
    input.session,
    input.messages,
  );
  const messages = await mapSnapshotMessages(input.app, input.messages);
  return {
    messages,
    projection: mapSessionProjection(projection),
    protocol: {
      name: MYCODE_PROTOCOL_NAME,
      version: MYCODE_PROTOCOL_VERSION,
    },
    runtime: mapRuntimeState({
      activeTurn,
      deliveryKind: input.deliveryKind,
      eventSeq: input.eventSeq,
      messages: input.messages,
      persistedContextUsageBreakdownEvents: input.persistedContextUsageBreakdownEvents,
      projection,
      stateRevision: input.stateRevision,
    }),
    session: mapSessionInfo({
      app: input.app,
      fallbackCreatedAt: input.fallbackCreatedAt,
      fallbackUpdatedAt: input.fallbackUpdatedAt,
      projection,
      session: input.session,
      workspace: input.workspace,
    }),
    settings: await mapSessionSettings(input.app, {
      currentModelContextWindow: projection.contextWindow,
      modelAvailability: input.modelAvailability,
    }),
    slashCommands: await listProtocolSlashCommands({
      ...input.slashCommandOptions,
      workingDirectory: input.workspace.workspacePath,
    }),
    goalStats: buildGoalStats(projection, input.messages),
    todos: input.todos?.map(mapTodoItem) ?? [],
    todoGroups: buildTodoGroups(input.messages, input.todos ?? [], projection),
  };
}

function buildTodoGroups(
  messages: readonly MessageWithParts[],
  currentTodos: readonly TodoItem[],
  projection: SessionProjection,
): MyCodeSessionTodoGroup[] {
  const target = projection.target;
  const timeline = getTargetGoalVerificationTimeline(projection, target);
  const groups = new Map<string, MyCodeSessionTodoGroup>();
  const todoOwners = new Map<string, { fingerprint: string; groupId: string }>();
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
    for (const part of message.parts) {
      if (
        part.type !== "tool" ||
        !isTodoWriteToolName(part.tool) ||
        !isMainAgentToolProjectionSource(part.metadata, readToolStateMetadata(part.state))
      ) {
        continue;
      }
      const todos = readTodosFromToolInput(part.state.input);
      if (!todos) {
        continue;
      }
      const updatedAt =
        readToolStateUpdatedAt(part.state) ??
        message.info.time.completed ??
        message.info.time.created;
      const groupId = goalIteration ? `goal-iteration-${goalIteration}` : "session";
      const group = ensureTodoGroup(groups, {
        goalIteration,
        groupId,
        startedAt: goalIteration
          ? getGoalIterationStartedAt(goalIteration, target, timeline, message.info.time.created)
          : message.info.time.created,
        targetId: goalIteration ? target?.targetID : undefined,
        updatedAt,
      });
      for (const todo of todos) {
        const fingerprint = normalizeTodoContent(todo.content);
        const ownerKey = `${target?.targetID ?? "session"}\u0000${fingerprint}`;
        const owner = todoOwners.get(ownerKey);
        if (owner) {
          const ownerGroup = groups.get(owner.groupId);
          if (ownerGroup) {
            addOrUpdateTodoInGroup(ownerGroup, owner.fingerprint, todo);
            ownerGroup.updatedAt = Math.max(ownerGroup.updatedAt ?? 0, updatedAt);
          }
          continue;
        }
        todoOwners.set(ownerKey, { fingerprint, groupId });
        addOrUpdateTodoInGroup(group, fingerprint, todo);
      }
    }
  }

  if (groups.size === 0 && currentTodos.length > 0) {
    groups.set("session-current", {
      id: "session-current",
      source: "session",
      todos: currentTodos.map(mapTodoItem),
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftTime = left.startedAt ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.startedAt ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

export { mapSessionSettings } from "./session-mapper-map-session-settings.js";
export { mapSessionInfo } from "./session-mapper-map-session-settings.js";
export { mapSessionEvent } from "./session-mapper-map-session-event.js";
export { mapSessionEventForProtocol } from "./session-mapper-map-session-event.js";
export { mapSessionEvents } from "./session-mapper-map-session-event.js";
export { shouldExposeSessionEventToProtocol } from "./session-mapper-map-session-event.js";
export { resolveSessionContextUsage } from "./session-mapper-map-session-settings.js";
