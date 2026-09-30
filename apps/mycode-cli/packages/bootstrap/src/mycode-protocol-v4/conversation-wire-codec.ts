import type {
  CommandEnvelope,
  ConversationDelta,
  ConversationSnapshot,
  ConversationTopicFrame,
  DeliveryProfile,
  DeliveryProfileName,
  QueueItem,
  ToolCallRow,
  V4ConversationPlansResult,
  V4ConversationRowsRangeResult,
} from "@mycode/shared/mycode-protocol-v4";
import {
  DELIVERY_PROFILES,
  PROTOCOL_V4_LIMITS,
  clampWorkflowRunsForLegacy,
  filterConversationDeltasForProfile,
  filterConversationRowsForProfile,
  utf8JsonByteLength,
} from "@mycode/shared/mycode-protocol-v4";
import { encodeConversationDeltasForLegacy } from "./conversation-workflow-run-deltas.js";

import {
  type Subscription,
  TERMINAL_PLAN_STATUSES,
  hasPlanMarkdown,
} from "./conversation-topic-publisher-projection-payload-too-large-error.js";
/** Read-only wire views; the getter always observes the publisher's adopted projection. */
export class ConversationWireCodec {
  constructor(
    private readonly topic: string,
    private readonly logEpoch: string,
    private readonly snapshot: () => ConversationSnapshot,
  ) {}
  /**
   * 下发用快照：rows 只带尾部窗口（snapshotTailWindowRows），
   * totalCount/firstRowId 保留全序口径——客户端以 `window[0].rowId === firstRowId`
   * 判定已到顶，更早历史经 rows/range 游标拉取。投影内部快照保持全量
   * （rows/range 数据源 + findRow/messageId 锚点都依赖它），只在打帧边界截断。
   */
  getWireSnapshot(snapshot = this.snapshot()): ConversationSnapshot {
    return this.getWireSnapshotForProfile(DELIVERY_PROFILES.continuous, snapshot);
  }
  getWireSnapshotForProfile(
    profile: DeliveryProfile,
    snapshot = this.snapshot(),
  ): ConversationSnapshot {
    const visibleRows = filterConversationRowsForProfile(snapshot.rows.window, profile);
    const visibleSnapshot: ConversationSnapshot = {
      ...snapshot,
      rows: {
        ...snapshot.rows,
        window: visibleRows,
        totalCount: visibleRows.length,
        firstRowId: visibleRows[0]?.rowId ?? null,
      },
    };
    const limit = PROTOCOL_V4_LIMITS.snapshotTailWindowRows;
    if (visibleRows.length <= limit) return visibleSnapshot;
    return {
      ...visibleSnapshot,
      rows: { ...visibleSnapshot.rows, window: visibleRows.slice(-limit) },
    };
  }
  /**
   * 一个订阅者的快照帧：profile 决定行可见性，能力位决定 `workflowRuns` 发全量还是旧界。
   *
   * 快照与增量必须同一档：一个收着旧界整键 patch 的客户端，如果快照里突然来了 512 个节点，
   * 它的 `.max(256)` 会让**整帧**解析失败（已知键上的解析错误不会只剥掉一个键）。
   */
  getWireSnapshotForSubscription(subscription: Subscription): ConversationSnapshot {
    const snapshot = this.getWireSnapshotForProfile(subscription.profile);
    if (subscription.workflowRunDeltas || snapshot.workflowRuns === undefined) return snapshot;
    const workflowRuns = clampWorkflowRunsForLegacy(snapshot.workflowRuns);
    return workflowRuns === snapshot.workflowRuns ? snapshot : { ...snapshot, workflowRuns };
  }
  /**
   * 一批 delta 的**每订阅者**编码：profile 过滤 + 旧消费者的整键折叠。
   *
   * 折叠取的是**当前**投影状态，所以恢复回放上历史增量会折成终态——中间态被跳过，终态一致，
   * 与 coalesce 的既有行为同规（conversation-workflow-run-deltas.ts 的文件头）。
   */
  encodeDeltasForSubscription(
    deltas: readonly ConversationDelta[],
    subscription: Subscription,
  ): readonly ConversationDelta[] {
    const filtered = filterConversationDeltasForProfile(deltas, subscription.profile);
    if (subscription.workflowRunDeltas) return filtered;
    return encodeConversationDeltasForLegacy(filtered, this.snapshot().workflowRuns);
  }
  /**
   * 输入 admission 的候选 projection：用完整 QueueItem 表达同一份 intent，覆盖文本与附件引用。
   * QueueItem 元数据不小于立即启动后的 user row，因此通过此闸门的输入不会在后续首次
   * snapshot 才变成不可传输。此方法只读，不写 admission / event log。
   */
  measureInputAdmissionProjectionBytes(
    envelope: CommandEnvelope,
    admission: { admissionSeq: number; admittedAt: number; queueItemId: string },
  ): number | null {
    const raw = envelope.payload as {
      text?: string;
      displayText?: string;
      attachments?: QueueItem["attachments"];
      firstInput?: { text: string; attachments?: QueueItem["attachments"] };
    };
    const input = envelope.type === "createSession" ? raw.firstInput : raw;
    if (
      !input ||
      (envelope.type !== "createSession" &&
        envelope.type !== "sendText" &&
        envelope.type !== "sendGoalCommand" &&
        envelope.type !== "compact")
    ) {
      return null;
    }
    const snapshot = this.snapshot();
    const queueItem: QueueItem = {
      sourceCommandId: envelope.commandId,
      queueItemId: admission.queueItemId,
      clientId: envelope.clientId || "cli",
      kind:
        envelope.type === "compact"
          ? "compact"
          : envelope.type === "sendGoalCommand"
            ? "sendGoalCommand"
            : "sendText",
      text:
        envelope.type === "compact"
          ? "/compact"
          : envelope.type === "sendGoalCommand"
            ? raw.displayText?.trim() || `/goal ${(input.text ?? "").trim()}`
            : (input.text ?? ""),
      attachments: input.attachments ?? [],
      delivery: { requested: "queue", admitted: "queue" },
      order: {
        admissionSeq: admission.admissionSeq,
        queuePosition: snapshot.queue.items.length,
      },
      steer: { state: "notRequested" },
      dispatch: { state: "queued" },
      admittedAt: admission.admittedAt,
    };
    const candidate: ConversationSnapshot = {
      ...snapshot,
      queue: { ...snapshot.queue, items: [...snapshot.queue.items, queueItem] },
    };
    return this.measureWireSnapshotBytes(this.getWireSnapshot(candidate));
  }
  measureWireSnapshotBytes(snapshot: ConversationSnapshot): number {
    // subscriptionId/时间/seq 使用本 publisher 可产生的最长常规表示，确保测量不是只算 payload。
    const frame: ConversationTopicFrame = {
      topic: this.topic,
      subscriptionId: `sub-${this.logEpoch}-${Number.MAX_SAFE_INTEGER}`,
      fromSeq: 0,
      toSeq: snapshot.seq,
      sentAt: Number.MAX_SAFE_INTEGER,
      payload: { kind: "snapshot", snapshot },
    };
    return utf8JsonByteLength(frame);
  }
  /**
   * rows/range（游标制）：取 rowId < beforeRowId 的最后 limit 行
   * （rowId 升序返回）。数据源 = 投影全量行（事件重放/transcript hydration 已灌入），
   * 与订阅流出自同一归约，天然满足「与全量重放前缀逐字节一致」。
   * 只读、无状态、超时重发安全；atLogEpoch 供客户端陈旧读整体丢弃。
   */
  getRowsRange(
    params: { beforeRowId?: number; limit: number },
    deliveryProfile: DeliveryProfileName = "replayable",
  ): V4ConversationRowsRangeResult {
    const snapshot = this.snapshot();
    const limit = Math.max(1, Math.min(params.limit, PROTOCOL_V4_LIMITS.rowsRangeMaxLimit));
    const visibleRows = filterConversationRowsForProfile(
      snapshot.rows.window,
      DELIVERY_PROFILES[deliveryProfile],
    );
    const eligible =
      params.beforeRowId === undefined
        ? visibleRows
        : visibleRows.filter((row) => row.rowId < (params.beforeRowId as number));
    const rows = eligible.slice(-limit);
    return {
      rows,
      atSeq: snapshot.seq,
      atRevision: snapshot.revision,
      atLogEpoch: this.logEpoch,
      hasMore: eligible.length > rows.length,
    };
  }
  /**
   * 返回当前有效分支里的完整终态计划目录。
   * wire snapshot 只保留 tail window；renderer 扫描可见 rows 会漏掉早期计划，
   * edit/retry 后还可能保留已经被权威 projection 裁掉的旧目录项。
   */
  getPlans(): V4ConversationPlansResult {
    const snapshot = this.snapshot();
    const plans = snapshot.rows.window
      .filter(
        (row): row is ToolCallRow =>
          row.kind === "toolCall" &&
          row.toolName === "ExitPlanMode" &&
          TERMINAL_PLAN_STATUSES.has(row.status) &&
          hasPlanMarkdown(row),
      )
      .toSorted((left, right) => right.rowId - left.rowId);
    return {
      plans,
      atSeq: snapshot.seq,
      atLogEpoch: this.logEpoch,
    };
  }
}
