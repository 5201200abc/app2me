import { SessionEventType, createSessionEvent } from "../deps.js";
import type {
  CollaborationMode,
  ModelSelection,
  ModelSelectionOrigin,
  TraceContext,
} from "../deps.js";
import { cloneModelSelection } from "../model-selection.js";
import { createRuntimeModel } from "./runtime-model.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { persistSessionInputUpdates } from "./steering-has-inline-guide-pending-input.js";

/**
 * （v4 queue 重排）：把 pendingInputId 移到 beforePendingInputId 之前（null = 移到队尾），
 * 发 TurnSteerReordered(新序)。v4 reducer 按新序重排 queue rows。未命中 → false。
 */
export async function reorderPendingInput(
  this: AgentRuntimeInternal,
  options: {
    pendingInputId: string;
    beforePendingInputId: string | null;
    traceContext: TraceContext;
  },
): Promise<boolean> {
  const activeTurn = this.activeTurn;
  const fromIndexActive =
    activeTurn?.pendingInputs.findIndex((item) => item.id === options.pendingInputId) ?? -1;
  if (!activeTurn || fromIndexActive < 0) {
    // held 回落：在投影序上重排后发 TurnSteerReordered（v4 reducer 按新序重排）。
    const projection = await this.rebuildProjection();
    const heldIds = projection.pendingSteerInputs.map((item) => item.pendingInputId);
    const fromIndex = heldIds.indexOf(options.pendingInputId);
    if (fromIndex < 0) return false;
    heldIds.splice(fromIndex, 1);
    if (options.beforePendingInputId === null) {
      heldIds.push(options.pendingInputId);
    } else {
      const beforeIndex = heldIds.indexOf(options.beforePendingInputId);
      if (beforeIndex < 0) {
        heldIds.push(options.pendingInputId);
      } else {
        heldIds.splice(beforeIndex, 0, options.pendingInputId);
      }
    }
    await persistSessionInputUpdates(
      this,
      heldIds.map((id, queuePosition) => ({ id, queuePosition })),
    );
    const targetTurnId =
      projection.pendingSteerInputs.find((item) => item.pendingInputId === options.pendingInputId)
        ?.targetTurnId ?? projection.pendingSteerInputs[0]!.targetTurnId;
    const event = createSessionEvent(
      SessionEventType.TurnSteerReordered,
      this.sessionId,
      {
        orderedPendingInputIds: heldIds,
        targetTurnId,
      },
      {
        traceId: options.traceContext.traceId,
        turnId: targetTurnId,
      },
    );
    await this.appendEvent(event, options.traceContext);
    return true;
  }
  const items = [...activeTurn.pendingInputs];
  const fromIndex = items.findIndex((item) => item.id === options.pendingInputId);
  if (fromIndex < 0) return false;
  const [moved] = items.splice(fromIndex, 1);
  if (!moved) return false;
  if (options.beforePendingInputId === null) {
    items.push(moved);
  } else {
    const beforeIndex = items.findIndex((item) => item.id === options.beforePendingInputId);
    if (beforeIndex < 0) {
      // 目标锚点已消失 → 退回队尾，不丢项。
      items.push(moved);
    } else {
      items.splice(beforeIndex, 0, moved);
    }
  }
  // 只重排数组而不更新 intent.queuePosition，会让 live queue 顺序正确，
  // 但 drain 后 transcript 又写回 admission 时的旧位置，造成冷热投影事实分叉。
  const reorderedItems = items.map((item, index) =>
    item.intent ? { ...item, intent: { ...item.intent, queuePosition: index } } : item,
  );
  await persistSessionInputUpdates(
    this,
    reorderedItems.map((item, queuePosition) => ({ id: item.id, queuePosition })),
  );
  activeTurn.pendingInputs.splice(0, activeTurn.pendingInputs.length, ...reorderedItems);
  const event = createSessionEvent(
    SessionEventType.TurnSteerReordered,
    this.sessionId,
    {
      orderedPendingInputIds: reorderedItems.map((item) => item.id),
      targetTurnId: activeTurn.turnId,
    },
    {
      traceId: activeTurn.traceContext.traceId,
      turnId: activeTurn.turnId,
    },
  );
  await this.appendEvent(event, options.traceContext);
  return true;
}

/**
 * （v4 setAutoDrain）：翻转 queue autoDrain 授权位（会话级配置，与 active turn 无关）。
 * 仅追加 QueueAutoDrainChanged 事件供 v4 投影消费；held 派生（completed+queue>0+autoDrain=false
 * → choice 路由）与后续 heldQueueDisposition 命令闭合发送语义。
 */
export async function setQueueAutoDrain(
  this: AgentRuntimeInternal,
  options: {
    autoDrain: boolean;
    traceContext: TraceContext;
  },
): Promise<void> {
  // false -> true 表示用户从暂停队列恢复。旧暂停项只存在于事件投影，不在新
  // activeTurn.pendingInputs 中；恢复期间改由 CLI 外层按完整投影 FIFO 逐项提升。
  if (options.autoDrain && !this.queueAutoDrain) {
    this.queueExternalDrainActive = true;
  } else if (!options.autoDrain) {
    this.queueExternalDrainActive = false;
  }
  // 授权位同时进 runtime（drain 门）与事件日志（投影派生暂停队列）。
  this.queueAutoDrain = options.autoDrain;
  const event = createSessionEvent(
    SessionEventType.QueueAutoDrainChanged,
    this.sessionId,
    { autoDrain: options.autoDrain },
    { traceId: options.traceContext.traceId },
  );
  await this.appendEvent(event, options.traceContext);
}

/** CLI 投影确认恢复队列已空后，重新允许 core 在后续 tool batch 边界消费 guide。 */
export function completeExternalQueueDrain(this: AgentRuntimeInternal): void {
  this.queueExternalDrainActive = false;
}

/**
 * （v4 setFollowupMode）：翻转 followup 路由模式（会话级配置）。
 * 仅追加 FollowupModeChanged 事件供 v4 投影消费；running 时 computeInputRouting 依此在
 * enqueue（queue）与 guide 之间选择。
 */
export async function setFollowupMode(
  this: AgentRuntimeInternal,
  options: {
    mode: "queue" | "guide";
    traceContext: TraceContext;
  },
): Promise<void> {
  const event = createSessionEvent(
    SessionEventType.FollowupModeChanged,
    this.sessionId,
    { mode: options.mode },
    { traceId: options.traceContext.traceId },
  );
  await this.appendEvent(event, options.traceContext);
}

/**
 * （v4 switchModelConfig）：模型选型变化后追加 ModelSelected 事件供投影消费。
 * v4 reducer 的 onModelSelected 依此更新 config.provider/model/thought 和实际 context window，
 * 并（中途切换时）产出 modelChange marker。实际 provider client 切换由 app.setModel 完成，
 * 此处把切换后的完整模型能力元组写入同一个事件。
 */
export async function emitModelSelected(
  this: AgentRuntimeInternal,
  options: {
    modelSelection: ModelSelection;
    model?: import("../deps.js").Model;
    effectiveReasoningLevel?: string;
    previousModelSelection?: ModelSelection | null;
    origin?: ModelSelectionOrigin;
    supportedThoughtLevels?: readonly string[];
    traceContext: TraceContext;
  },
): Promise<void> {
  const model = options.model ?? createRuntimeModel(this, { selection: options.modelSelection });
  const event = createSessionEvent(
    SessionEventType.ModelSelected,
    this.sessionId,
    {
      // 模型切换事件必须从本次创建的 Active Model 读取窗口，不能再复制 Runtime Config。
      contextWindow: model.properties.contextWindow,
      modelSelection: cloneModelSelection(options.modelSelection),
      ...(options.effectiveReasoningLevel
        ? { effectiveReasoningLevel: options.effectiveReasoningLevel }
        : {}),
      // previousModelSelection=null 是显式 ∅→X 模型边界，不能按 truthy 判断丢失。
      ...(options.previousModelSelection !== undefined
        ? {
            previousModelSelection: options.previousModelSelection
              ? cloneModelSelection(options.previousModelSelection)
              : null,
          }
        : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.supportedThoughtLevels
        ? { supportedThoughtLevels: [...options.supportedThoughtLevels] }
        : {}),
    },
    { traceId: options.traceContext.traceId },
  );
  await this.appendEvent(event, options.traceContext);
}

/**
 * （v4 switchCollaborationMode）：命令面切换协作模式后追加 SessionModeChanged 事件。
 * app.setMode 只更新 runtime config + 持久化偏好、不产事件（session-mode-port 的
 * enterPlanMode/exitPlanMode 仅覆盖 plan 工具路径），v4 投影的 config.mode 更新靠这条补发。
 */
export async function emitModeChanged(
  this: AgentRuntimeInternal,
  options: {
    mode: CollaborationMode;
    previousMode: CollaborationMode;
    traceContext: TraceContext;
  },
): Promise<void> {
  const event = createSessionEvent(
    SessionEventType.SessionModeChanged,
    this.sessionId,
    {
      mode: this.getMode(),
      planEnabled: this.getPlanEnabled(),
      previousMode: options.previousMode,
      source: "command",
    },
    { traceId: options.traceContext.traceId },
  );
  await this.appendEvent(event, options.traceContext);
}
