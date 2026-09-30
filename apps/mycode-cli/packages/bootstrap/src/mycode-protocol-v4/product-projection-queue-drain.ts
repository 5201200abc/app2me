import type {
  SessionEvent,
  SessionInputPromotedPayload,
  TurnInputIntentMetadata,
  TurnSteerDiscardedPayload,
  TurnSteerDrainedPayload,
} from "@mycode/contracts";

import type { ConversationDelta, ConversationSnapshot } from "@mycode/shared/mycode-protocol-v4";

import { buildTurnHeaderRow } from "./projection-rows.js";
import { computeAvailability, computeInputRouting } from "./projection-state.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionQueueDrain = {
  onTurnSteerDrained(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as TurnSteerDrainedPayload;
    const runtimeTurnId = String(
      payload.targetTurnId ?? event.turnId ?? this.currentTurnId ?? "turn-unknown",
    );
    // drain 事实优先自带文本/messageId（drainedInputs），
    // 投影不再依赖内存 queue 状态取文本——旧实现查不到 queue item 就静默 continue，
    // 用户输入从 queue 消失后也不进 history。旧事件（无 drainedInputs）回退查表。
    const items =
      payload.drainedInputs ??
      payload.pendingInputIds.flatMap((pendingInputId, index) => {
        const queueItem = this.snapshot.queue.items.find(
          (candidate) => candidate.queueItemId === pendingInputId,
        );
        if (!queueItem) return [];
        const intent: TurnInputIntentMetadata = {
          sourceCommandId: queueItem.sourceCommandId,
          queueItemId: queueItem.queueItemId,
          clientId: queueItem.clientId,
          kind: queueItem.kind,
          text: queueItem.text,
          ...(queueItem.modelSelection ? { modelSelection: queueItem.modelSelection } : {}),
          ...(queueItem.mode ? { mode: queueItem.mode } : {}),
          ...(queueItem.planEnabled !== undefined ? { planEnabled: queueItem.planEnabled } : {}),
          admissionSeq: queueItem.order.admissionSeq,
          admittedAt: queueItem.admittedAt,
          requestedDelivery: queueItem.delivery.requested,
          admittedDelivery: queueItem.delivery.admitted,
          queuePosition: queueItem.order.queuePosition,
          ...(queueItem.delivery.fallbackReasonCode
            ? { fallbackReasonCode: queueItem.delivery.fallbackReasonCode }
            : {}),
          attachmentRefs: queueItem.attachments,
        };
        return [
          {
            pendingInputId,
            messageId: payload.injectedMessageIds?.[index],
            text: queueItem.text,
            delivery: this.deliveryByPendingInputId.get(pendingInputId),
            intent,
          },
        ];
      });

    const deltas: ConversationDelta[] = [];
    for (const item of items) {
      const delivery =
        item.delivery ?? this.deliveryByPendingInputId.get(item.pendingInputId) ?? "queue";
      // queue 消费 = product turn 边界（每条一轮：收口上一段
      // header、开新 turnHeader、后续 assistant 归新轮）；guide steer 内联当前轮。
      if (delivery === "queue") {
        deltas.push(
          ...this.splitProductTurn(
            event,
            runtimeTurnId,
            item.messageId ? String(item.messageId) : undefined,
          ),
        );
      }
      const messageId = item.messageId ? String(item.messageId) : null;
      const entityId = messageId ?? item.pendingInputId;
      const productTurnId = this.turnIdOf(event);
      const rootSourceCommandId =
        item.intent?.provenance?.sourceCommandId ?? item.intent?.sourceCommandId;
      const row = {
        ...this.rowBase(event, productTurnId, entityId),
        kind: "userInput" as const,
        text: item.text,
        origin: "realUser" as const,
        ...(delivery === "guide" ? { guided: true as const } : {}),
        ...(item.intent?.sourceCommandId ? { sourceCommandId: item.intent.sourceCommandId } : {}),
        ...(rootSourceCommandId ? { rootSourceCommandId } : {}),
        ...(item.intent?.clientId ? { clientId: item.intent.clientId } : {}),
        ...(item.intent?.attachmentRefs?.length ? { attachments: item.intent.attachmentRefs } : {}),
      };
      // queue/guide 消费后的 real-user row 与普通 TurnStarted 共用完整 canonical target；
      // 缺 messageId 的旧事件仍只可展示，不暴露无法执行的 edit action。
      this.registerCanonicalUserRowTarget(
        row.rowId,
        entityId,
        messageId && item.intent?.kind !== "compact"
          ? {
              entityId,
              productTurnId,
              transcriptMessageId: messageId,
              coveredByStableCompact: false,
              intent: {
                kind: item.intent?.kind === "sendGoalCommand" ? "sendGoalCommand" : "sendText",
                text: item.intent?.text ?? item.text,
                ...(item.intent?.sourceCommandId
                  ? { sourceCommandId: item.intent.sourceCommandId }
                  : {}),
                ...(item.intent?.clientId ? { clientId: item.intent.clientId } : {}),
                ...(item.intent?.attachmentRefs ? { attachments: item.intent.attachmentRefs } : {}),
                ...(item.intent?.queueItemId ? { queueItemId: item.intent.queueItemId } : {}),
                ...(item.intent?.admissionSeq !== undefined
                  ? { admissionSeq: item.intent.admissionSeq }
                  : {}),
                ...(item.intent?.admittedAt !== undefined
                  ? { admittedAt: item.intent.admittedAt }
                  : {}),
                ...(item.intent?.requestedDelivery
                  ? { requestedDelivery: item.intent.requestedDelivery }
                  : {}),
                ...(item.intent?.admittedDelivery
                  ? { admittedDelivery: item.intent.admittedDelivery }
                  : {}),
                ...(item.intent?.fallbackReasonCode
                  ? { fallbackReasonCode: item.intent.fallbackReasonCode }
                  : {}),
                ...(item.intent?.modelSelection
                  ? { modelSelection: item.intent.modelSelection }
                  : {}),
                ...(item.intent?.mode ? { mode: item.intent.mode } : {}),
                ...(item.intent?.planEnabled !== undefined
                  ? { planEnabled: item.intent.planEnabled }
                  : {}),
                ...(item.intent?.provenance ? { provenance: item.intent.provenance } : {}),
              },
            }
          : undefined,
      );
      if (delivery === "guide") {
        deltas.push(...this.openGuidedWorkSegment(event, row.entityId ?? item.pendingInputId));
      }
      deltas.push({ op: "row.appended", row });
      this.deliveryByPendingInputId.delete(item.pendingInputId);
    }
    return [...deltas, ...this.removeQueueItems(payload.pendingInputIds)];
  },
  /**
   * queue drain 边界 = product turn 边界（同一 runtimeTurn 内）。
   * 收口上一段 productTurn 的 header（工时按边界拆分，加和 = 总工时），
   * 映射 runtimeTurnId → 新 productTurnId，开新 turnHeader。
   */
  splitProductTurn(
    this: ProjectionEngine,
    event: SessionEvent,
    runtimeTurnId: string,
    promotedUserMessageId?: string,
  ): ConversationDelta[] {
    const deltas: ConversationDelta[] = [];
    const previousProductTurnId =
      this.productTurnIdByRuntimeTurnId.get(runtimeTurnId) ?? runtimeTurnId;
    const headerRowId = this.turnHeaderRowIdByTurnId.get(previousProductTurnId);
    const headerRow = headerRowId !== undefined ? this.findRow(headerRowId) : undefined;
    if (headerRow?.kind === "turnHeader") {
      const endedAt = this.ms(event);
      deltas.push({
        op: "row.upserted",
        row: {
          ...headerRow,
          state: "completedSuccess",
          endedAt,
          activeMs: Math.max(
            0,
            endedAt - (this.currentProductTurnStartedAtMs ?? headerRow.startedAt),
          ),
          ...(headerRow.workSegments
            ? {
                workSegments: this.completeWorkSegments(headerRow.workSegments, endedAt),
              }
            : {}),
        },
      });
    }
    const ordinal = (this.productTurnSplitOrdinalByRuntimeTurnId.get(runtimeTurnId) ?? 0) + 1;
    this.productTurnSplitOrdinalByRuntimeTurnId.set(runtimeTurnId, ordinal);
    // 旧实现用 runtimeTurnId + 本次进程内 ordinal 造 productTurnId；
    // cold hydration 会改用 hydrate-turn-N，同一条 queue 输入恢复前后无法保持身份。
    // promotion 已产生持久 user messageId，新 product turn 必须直接使用该权威身份；
    // 只有 legacy drain 缺 messageId 时才保留 ordinal fallback。
    const productTurnId = promotedUserMessageId ?? `${runtimeTurnId}~q${ordinal}`;
    this.productTurnIdByRuntimeTurnId.set(runtimeTurnId, productTurnId);
    this.runtimeTurnIdByProductTurnId.set(productTurnId, runtimeTurnId);
    this.currentProductTurnStartedAtMs = this.ms(event);
    const header = buildTurnHeaderRow(this.rowBase(event, productTurnId, productTurnId), {
      turnNumber: 0,
      input: "",
    });
    this.turnHeaderRowIdByTurnId.set(productTurnId, header.rowId);
    deltas.push({ op: "row.appended", row: header });
    return deltas;
  },
  // 工时按边界拆分：drain 切过轮的 runtimeTurn，最后一段 productTurn 的工时
  // = 最后一次边界到完成，不再用整段 runtime duration（否则两段加和超真实时长）。
  activeMsForCompletion(
    this: ProjectionEngine,
    event: SessionEvent,
    runtimeDuration?: number,
  ): number | undefined {
    const runtimeTurnId = String(event.turnId ?? this.currentTurnId ?? "turn-unknown");
    // 稳定 user messageId 映射并不代表发生过 queue drain 切段；只有 split ordinal
    // 存在时才按边界时间计算最后一段工时。否则 cold 合成事件的展示时间戳跨度很小，
    // 会错误覆盖 transcript 已计算好的整轮 duration。
    if (!this.productTurnSplitOrdinalByRuntimeTurnId.has(runtimeTurnId)) return runtimeDuration;
    if (this.currentProductTurnStartedAtMs === null) return runtimeDuration;
    return Math.max(0, this.ms(event) - this.currentProductTurnStartedAtMs);
  },
  onTurnSteerDiscarded(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as TurnSteerDiscardedPayload;
    return this.removeQueueItems(payload.pendingInputIds);
  },
  onSessionInputPromoted(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as SessionInputPromotedPayload;
    // sendQueuedNow 启动成功后，显式 TurnSteerDiscarded(promoted)
    // 可能在进程/链路边界丢失，使 UI 永久留下 promoting 幽灵项。
    // SessionInputPromoted 只在 user message + session_input 同事务提交后产生，
    // 因此它才是可以安全移除 queue 投影的 durable commit signal。
    return this.removeQueueItems([payload.pendingInputId]);
  },
  /** v4 queue 重排：按 orderedPendingInputIds 重排 queue rows（未列出的项保持相对顺序追加）。 */
  onTurnSteerReordered(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as { orderedPendingInputIds?: string[] };
    const order = payload.orderedPendingInputIds ?? [];
    const byId = new Map(this.snapshot.queue.items.map((item) => [item.queueItemId, item]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((item): item is (typeof this.snapshot.queue.items)[number] => item !== undefined);
    // 未在 order 里出现的项（防丢）追加保持原相对序。
    const orderedIds = new Set(order);
    const rest = this.snapshot.queue.items.filter((item) => !orderedIds.has(item.queueItemId));
    const reordered = [...ordered, ...rest];
    const items = reordered.map((item, index) =>
      item.order.queuePosition === index
        ? item
        : { ...item, order: { ...item.order, queuePosition: index } },
    );
    // 顺序无变化则不产 delta（幂等）。
    if (
      items.length === this.snapshot.queue.items.length &&
      items.every((item, index) => item === this.snapshot.queue.items[index])
    ) {
      return [];
    }
    return [
      {
        op: "state.updated",
        patch: this.queuePatch({ ...this.snapshot.queue, items }),
      },
    ];
  },
  // setAutoDrain：queue.autoDrain 授权位翻转。autoDrain 影响 held 派生
  // （heldQueueInputRequiresChoice）与 A 区可用性 → 走 queuePatch 统一重算。
  onQueueAutoDrainChanged(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as { autoDrain?: boolean };
    const autoDrain = payload.autoDrain ?? true;
    if (
      this.snapshot.queue.autoDrain === autoDrain &&
      (autoDrain || this.snapshot.queue.pauseReason === "manual")
    ) {
      return [];
    }
    const queue = { ...this.snapshot.queue, autoDrain };
    if (autoDrain) {
      delete queue.pauseReason;
    } else {
      queue.pauseReason = "manual";
    }
    return [
      {
        op: "state.updated",
        patch: this.queuePatch(queue),
      },
    ];
  },
  // setFollowupMode：config.followupMode 翻转。followupMode 是 running 时
  // enqueue vs guide 的路由授权位（computeInputRouting）→ 改 config 后同步重算 A 区。
  onFollowupModeChanged(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as { mode?: "queue" | "guide" };
    const mode: "queue" | "guide" = payload.mode === "guide" ? "guide" : "queue";
    if (this.snapshot.config.followupMode === mode) return [];
    const nextConfig: ConversationSnapshot["config"] = {
      ...this.snapshot.config,
      followupMode: mode,
    };
    const context = this.deriveContext({});
    return [
      {
        op: "state.updated",
        patch: {
          config: nextConfig,
          availability: computeAvailability(context),
          inputRouting: computeInputRouting(context, mode),
        },
      },
    ];
  },
};
export type ProjectionQueueDrainMethods = typeof projectionQueueDrain;
