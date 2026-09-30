import {
  mycodeContextUsageBreakdownSchema,
  type MyCodeDeliveryKind,
  type MyCodeSessionContextUsage,
  type MyCodeSessionGoalVerification,
  type MyCodeSessionGoalVerificationTimeline,
  type MyCodeSessionInfo,
  type MyCodeSessionKind,
  type MyCodeSessionRuntimeState,
  type MyCodeSessionSettingsState,
  type MyCodeWorkspaceRef,
} from "@mycode/shared";
import {
  SessionEventType,
  getModelUsageContextTokens,
  type MessageWithParts,
  type ModelCompletePayload,
  type SessionEvent,
  type SessionInfo,
  type SessionProjection,
} from "@mycode/contracts";
import type { MyCodeApp } from "../app/types.js";
import { formatProtocolModelSelection, optionalModelSelectionFromString } from "./model-mapper.js";
import {
  positiveInteger,
  mapSessionGoal,
  contextUsageFromPersistedMessages,
  applyContextUsageBreakdown,
  contextUsageFromProjection,
  type ContextUsageBreakdownCandidate,
} from "./session-mapper-map-session-projection.js";
import { stringValue } from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";

export async function mapSessionSettings(
  app: MyCodeApp,
  options: {
    currentModelContextWindow?: number;
    modelAvailability?: "all" | "current";
  } = {},
): Promise<MyCodeSessionSettingsState> {
  const thoughtLevels = app.listThoughtLevels();
  const rawCurrentThoughtLevel = app.getThoughtLevel();
  // setModel 后 runtime 可能短暂保留上一个模型的 thoughtLevel。
  // 协议 snapshot 是 UI/测试共同事实源，不能返回不在当前模型可选列表里的 current。
  const currentThoughtLevel =
    rawCurrentThoughtLevel && thoughtLevels.includes(rawCurrentThoughtLevel)
      ? rawCurrentThoughtLevel
      : undefined;
  const rawDefaultThoughtLevel = app.getDefaultThoughtLevel();
  const defaultThoughtLevel =
    rawDefaultThoughtLevel && thoughtLevels.includes(rawDefaultThoughtLevel)
      ? rawDefaultThoughtLevel
      : undefined;
  const currentModel = app.getModel();
  const currentModelOption = app.getCurrentModelOption?.();
  const availableModels =
    options.modelAvailability === "current"
      ? currentModelOption
        ? [
            {
              ...currentModelOption,
              contextWindow:
                positiveInteger(options.currentModelContextWindow) ??
                currentModelOption.contextWindow,
            },
          ]
        : app
            .listModels()
            .filter((candidate) => formatProtocolModelSelection(candidate.ref) === currentModel)
      : app.listModels();
  return {
    mode: {
      current: app.getMode(),
    },
    model: {
      // app/stdio 场景下 provider catalog 属于 app 状态，不应随每次 session/read、
      // setModel 回包返回完整模型市场；session settings 只需要表达当前运行模型即可。
      available: availableModels,
      // Session 原选择是后续输入解析的依据；字符串和过滤后的档位会丢失原意图。
      // current 允许暂时不可执行，展示/派发的有效性由公共 Selection View 决定。
      current: app.runtime.getSessionModelSelection(),
      lastUsed: optionalModelSelectionFromString(currentModel),
    },
    permission: {
      mode: app.getMode(),
    },
    thoughtLevel: {
      available: thoughtLevels.map((level) => ({ label: level, value: level })),
      current: currentThoughtLevel,
      // 云端 reasoning.defaultLevel 只存在于模型事实中，旧 settings
      // 没有携带默认档位，UI 在 current 为空时只能误选 available[0]。
      ...(defaultThoughtLevel ? { defaultLevel: defaultThoughtLevel } : {}),
      enabled: thoughtLevels.length > 0,
    },
  };
}

export function mapSessionInfo(input: {
  app?: Pick<MyCodeApp, "getMode" | "getModel" | "sessionId" | "traceId">;
  fallbackCreatedAt?: number;
  fallbackUpdatedAt?: number;
  projection?: SessionProjection;
  session?: SessionInfo | null;
  taskType?: SessionInfo["taskType"];
  parentSessionId?: string;
  workspace: MyCodeWorkspaceRef;
}): MyCodeSessionInfo {
  const sessionId = String(input.session?.id ?? input.app?.sessionId ?? "unknown");
  // 刚创建的 protocol session 可能还没有持久化 session 行。
  // 此时 runtime projection 的时间可能继承 workspace 预热 draft，不能作为正式 session 时间。
  const createdAt =
    input.session?.time.created ??
    input.fallbackCreatedAt ??
    input.projection?.createdAt.getTime() ??
    Date.now();
  const updatedAt =
    input.session?.time.updated ??
    input.fallbackUpdatedAt ??
    input.projection?.updatedAt.getTime() ??
    createdAt;
  return {
    archivedAt: input.session?.time.archived,
    createdAt,
    mode: input.projection?.mode ?? input.app?.getMode?.() ?? "build",
    model: input.app ? optionalModelSelectionFromString(input.app.getModel()) : undefined,
    parentSessionId: input.session?.parentID ?? input.parentSessionId,
    traceId: input.session?.traceID ?? input.app?.traceId,
    sessionId,
    sessionKind: (input.session?.taskType ?? input.taskType ?? "interactive") as MyCodeSessionKind,
    status: input.projection?.status ?? "idle",
    target: mapSessionGoal(input.projection?.target),
    title: input.session?.title ?? "",
    titleSource: input.session?.titleSource,
    updatedAt,
    workspace: input.workspace,
  };
}

export function mapRuntimeState(input: {
  activeTurn?: ReturnType<MyCodeApp["runtime"]["getActiveTurnInfo"]>;
  deliveryKind?: MyCodeDeliveryKind;
  eventSeq: number;
  messages: MessageWithParts[];
  persistedContextUsageBreakdownEvents?: readonly SessionEvent[];
  projection: SessionProjection;
  stateRevision: number;
}): MyCodeSessionRuntimeState {
  // projection.currentTurnId 是投影最后处理过的 turn，不代表当前仍在运行。
  // session 恢复/subscribe 快照如果把它回填成 runtime.activeTurnId，会让已 idle/complete 的任务误显示为 thinking。
  const activeTurnId = input.activeTurn?.turnId;
  const contextUsage = resolveSessionContextUsage({
    messages: input.messages,
    persistedContextUsageBreakdownEvents: input.persistedContextUsageBreakdownEvents,
    projection: input.projection,
  });
  // 共享 runtime schema 已用 activeTurnId/activeTurnKind 表达运行中 turn；
  // mainActive 是旧 UI 派生字段，继续从 CLI 快照写出会让 bootstrap 独立 build 失败。
  return {
    activeTurnId: activeTurnId ? String(activeTurnId) : undefined,
    activeTurnKind: input.activeTurn?.kind,
    deliveryKind: input.deliveryKind,
    eventSeq: input.eventSeq,
    pendingRequestIds: input.projection.pendingPermissions.map(
      (permission) => permission.requestId ?? permission.toolCallId,
    ),
    ...(contextUsage ? { contextUsage } : {}),
    goalVerifications: mapGoalVerifications(input.projection.targetCompletionVerifications),
    goalVerificationTimeline: mapGoalVerificationTimeline(
      input.projection.targetCompletionVerificationTimeline,
    ),
    stateRevision: input.stateRevision,
  };
}

/**
 * legacy snapshot 与 V4 usage 窄种子的共享计算口径。
 *
 * V4 冷恢复只需要 context usage，过去却通过 full legacy snapshot 间接读取。
 * 抽出纯投影后，两条路径继续共享 active-branch token/cache 与 breakdown 对齐规则。
 */
export function resolveSessionContextUsage(input: {
  messages: readonly MessageWithParts[];
  persistedContextUsageBreakdownEvents?: readonly SessionEvent[];
  projection: SessionProjection;
}): MyCodeSessionContextUsage | undefined {
  const persistedContextUsage = contextUsageFromPersistedMessages(
    input.messages,
    input.projection.contextWindow,
  );
  return applyContextUsageBreakdown(
    contextUsageFromProjection(
      input.projection,
      persistedContextUsage?.used === input.projection.contextUsed
        ? persistedContextUsage.cache
        : undefined,
    ) ?? persistedContextUsage,
    latestContextUsageBreakdownFromEvents(input.persistedContextUsageBreakdownEvents ?? []),
  );
}

export function latestContextUsageBreakdownFromEvents(
  events: readonly SessionEvent[],
): ContextUsageBreakdownCandidate | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== SessionEventType.ModelComplete) {
      continue;
    }
    const payload = event.payload as Partial<ModelCompletePayload>;
    const querySource = stringValue(payload.querySource);
    if (querySource !== undefined && querySource !== "main_turn") {
      continue;
    }
    const parsed = mycodeContextUsageBreakdownSchema.safeParse(payload.contextUsageBreakdown);
    const used = getModelUsageContextTokens(payload.usage);
    if (!parsed.success || parsed.data.length === 0 || used === undefined) {
      continue;
    }
    const contextWindow = positiveInteger(payload.contextWindow);
    // 冷恢复只能从 eventStore 重建 context breakdown；必须用 usage/window 对齐，
    // 避免把旧分支或 sidecar 模型请求的来源比例挂到当前 task meter 上。
    return {
      breakdown: parsed.data,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      used,
    };
  }
  return undefined;
}

export function mapGoalVerifications(
  verifications: SessionProjection["targetCompletionVerifications"] | undefined,
): MyCodeSessionGoalVerification[] {
  return (verifications ?? []).map((verification) => ({
    nextAction: verification.nextAction ?? null,
    passed: verification.passed,
    reason: verification.reason,
  }));
}

export function mapGoalVerificationTimeline(
  timeline: SessionProjection["targetCompletionVerificationTimeline"] | undefined,
): MyCodeSessionGoalVerificationTimeline[] {
  return (timeline ?? []).map((item) => ({
    version: 1,
    kind: "synthetic",
    type: "goal_verification",
    display: "separator",
    targetId: item.targetId,
    verificationId: item.verificationId,
    status: item.status,
    ...(item.goalIteration ? { goalIteration: item.goalIteration } : {}),
    ...(item.anchorAssistantMessageId
      ? { anchorAssistantMessageId: item.anchorAssistantMessageId }
      : {}),
    ...(item.anchorTurnId ? { anchorTurnId: item.anchorTurnId } : {}),
    ...(item.verification
      ? {
          verification: {
            nextAction: item.verification.nextAction ?? null,
            passed: item.verification.passed,
            reason: item.verification.reason,
          },
        }
      : {}),
    ...(item.startedAt ? { startedAt: item.startedAt.getTime() } : {}),
    updatedAt: item.updatedAt.getTime(),
  }));
}

export interface GoalIterationBucket {
  goalIteration: number;
  id: string;
  messageIds: Set<string>;
  startedAt?: number;
  targetId?: string;
  toolCallCount: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  updatedAt?: number;
}

export function isPassingGoalVerification(
  item: SessionProjection["targetCompletionVerificationTimeline"][number],
): boolean {
  return item.status === "completed" && item.verification?.passed === true;
}
