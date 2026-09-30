import { type BackgroundBashOutputResult } from "@mycode/shared/mycode-protocol-v4";
import type { SessionEvent } from "@mycode/contracts";
import type { ConversationSnapshot } from "@mycode/shared/mycode-protocol-v4";

import type {
  CommandAck,
  ConversationRowTarget,
  CommandsQueryResult,
  ConversationTopicFrame,
  QueueItem,
  RoutedTopicFrame,
  SessionsIndexTopicFrame,
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentCommitResult,
  V4AttachmentPreviewSourceResult,
  V4AttachmentReadResult,
  V4ConversationAttachmentReadResult,
  V4ConversationAttachmentStatResult,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
  V4ConversationPlansResult,
  V4ConversationWorkflowRunArtifactDataResult,
  V4ConversationWorkflowRunArtifactReadResult,
  V4ConversationWorkflowRunArtifactsResult,
  V4ConversationWorkflowRunNodeResultResult,
  V4ConversationWorkflowRunWorkspaceResult,
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunsResult,
  V4ConversationRowsRangeResult,
  WorkspaceConfigState,
  WorkspaceConfigTopicFrame,
} from "@mycode/shared/mycode-protocol-v4";

import type { ConversationRowTargetAction } from "./product-projection.js";

import {
  type V4GatewayHost,
  type ConversationV4GatewayOptions,
  DETACHED_CHILD_PUBLISHER_GRACE_MS,
  type V4SubscribeDispatchResult,
} from "./v4-gateway-v4-gateway-host.js";

import { V4GatewayEngine } from "./v4-gateway-engine.js";
export class ConversationV4Gateway {
  private readonly engine: V4GatewayEngine;
  constructor(host: V4GatewayHost, options: ConversationV4GatewayOptions = {}) {
    this.engine = new V4GatewayEngine(host, options);
  }
  /** session entry 状态变更后的轻量 metadata 更新，不重放 conversation event。 */
  updateSharedContextImport(
    sessionId: string,
    source: ConversationSnapshot["sharedContextImport"],
  ): void {
    return this.engine.updateSharedContextImport(sessionId, source);
  }
  setConnectionFlowState(rawParams: unknown): void {
    return this.engine.setConnectionFlowState(rawParams);
  }
  /** 权威事件入口：投影推进 + 各订阅者按 profile.flushWindowMs 调度打帧。 */
  ingest(sessionId: string, event: SessionEvent): void {
    return this.engine.ingest(sessionId, event);
  }
  /** 等待指定 raw event 真正完成 reorder drain + publisher projection apply。 */
  waitForProjectionEventCommit(
    sessionId: string,
    eventId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    return this.engine.waitForProjectionEventCommit(sessionId, eventId, options);
  }
  /** 授权已经提交到任务事务，失败重试必须重放权威日志，不能再次提权或丢弃提交事实。 */
  waitForPermissionGrantCommit(sessionId: string, eventId: string): Promise<void> {
    return this.engine.waitForPermissionGrantCommit(sessionId, eventId);
  }
  /**
   * subagent child 使用父 record 的外部 sink，但保留独立 session topic。显式登记这类
   * detached live session，避免把任意偶然存在的 cold publisher 都误判为运行中 child。
   */
  ingestDetachedLiveSession(
    sessionId: string,
    event: SessionEvent,
    parentSessionId?: string,
  ): void {
    return this.engine.ingestDetachedLiveSession(sessionId, event, parentSessionId);
  }
  /**
   * 低频 tick 兜底：释放已终态、无订阅者、且没有自己 record 的 detached child publisher。
   * 释放后再被订阅走既有 cold resume（child 作为 subagent_child 持久化在 session store）。返回释放数。
   */
  pruneDetachedChildPublishers(
    nowMs: number = Date.now(),
    graceMs: number = DETACHED_CHILD_PUBLISHER_GRACE_MS,
  ): number {
    return this.engine.pruneDetachedChildPublishers(nowMs, graceMs);
  }
  /**
   * sessions-index 订阅：订阅某 workspace 的会话列表（与 conversation subscribe 并列，
   * 同一 RPC 方法按 topic 前缀分派）。冷启动：store 摘要种子 + 已加载会话 live 投影覆盖。
   */
  subscribeSessionsIndex(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<SessionsIndexTopicFrame>> {
    return this.engine.subscribeSessionsIndex(rawParams);
  }
  subscribeSessionsIndexReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<SessionsIndexTopicFrame>> {
    return this.engine.subscribeSessionsIndexReserved(rawParams);
  }
  /**
   * workspace-config 订阅：订阅某 workspace 的配置目录（与 conversation subscribe 并列，
   * 同一 RPC 方法按 topic 前缀分派）。订阅时经宿主钩子拉取当前配置作种子。
   */
  subscribeWorkspaceConfig(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    return this.engine.subscribeWorkspaceConfig(rawParams);
  }
  subscribeWorkspaceConfigReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    return this.engine.subscribeWorkspaceConfigReserved(rawParams);
  }
  /**
   * 配置目录发布入口（宿主在 provider registry 应用 / workspace 默认项变更后调用，
   * 直接携带已构建好的目录，不回头重拉宿主，避免重复 buildWorkspaceState 的临时 app 成本）。
   * conflation 在 publisher 内完成（未变化不产帧）；无 publisher 时同步建一个空种子的
   * publisher 存住最新态，后续订阅者据此拿到完整 snapshot。
   */
  publishWorkspaceConfig(workspaceId: string, state: WorkspaceConfigState): void {
    return this.engine.publishWorkspaceConfig(workspaceId, state);
  }
  /** v4/conversation/subscribe：裁决 + server 内部 initial frame，公共响应由 server 只取 ACK。 */
  subscribe(rawParams: unknown): Promise<V4SubscribeDispatchResult<ConversationTopicFrame>> {
    return this.engine.subscribe(rawParams);
  }
  subscribeReserved(
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<ConversationTopicFrame>> {
    return this.engine.subscribeReserved(rawParams);
  }
  /**
   * v4/conversation/resync：按 owned topic/connection 精确命中现有 subscription，
   * 保持 subId/profile 不变，从客户端 base 重新裁决 resume/snapshot。
   */
  resyncReserved(rawParams: unknown): V4SubscribeDispatchResult<RoutedTopicFrame> {
    return this.engine.resyncReserved(rawParams);
  }
  /**
   * v4/conversation/rowsRange：按 beforeRowId 游标向上取一窗
   * 历史行。只读 query，不建订阅；数据源 = 该会话投影全量行——冷会话（重启后直开
   * 历史）复用与 subscribe 相同的冷恢复 + hydration 管线先把投影建起来。
   */
  rowsRange(rawParams: unknown): Promise<V4ConversationRowsRangeResult> {
    return this.engine.rowsRange(rawParams);
  }
  /** 完整有效 projection 的终态计划目录；冷会话复用订阅 hydration。 */
  plans(rawParams: unknown): Promise<V4ConversationPlansResult> {
    return this.engine.plans(rawParams);
  }
  /**
   * workflow run 事件日志的分页读取（cursor = journal sequence）。
   *
   * 与 rows/range、plans 同族：只读、无状态、超时重发安全。刻意**不是** v4 command——
   * command 的 ACK 结果是那个封闭的「变更结果」判别联合，一页只读事件不属于那个词汇表。
   *
   * `hasMore` 由「取满 limit」判定：多读一条来确认后面还有，比让 renderer 靠"这页正好满"
   * 猜测更可靠（正好取尽时不会白翻一页空的）。
   */
  workflowRunEvents(rawParams: unknown): Promise<V4ConversationWorkflowRunEventsResult> {
    return this.engine.workflowRunEvents(rawParams);
  }
  /**
   * dwf run 的枚举 query。与
   * workflowRunEvents 同族：只读、无状态、超时重发安全。limit 的缺省与钳制在 CLI 侧
   * （run service），这里只透传；`resumable` 由 CLI 按 resume 门的同一个谓词算好。
   */
  workflowRuns(rawParams: unknown): Promise<V4ConversationWorkflowRunsResult> {
    return this.engine.workflowRuns(rawParams);
  }
  /**
   * workflow run 的**用户面产物**清单。
   * 与 workflowRunEvents 同族：只读、无状态、超时重发安全。
   *
   * ⚠ 术语：这里的 artifact 是脚本经 `artifact.*` 发布给用户看的产出，不是 run 的顶层
   * 返回值（引擎内部对后者的同名叫法）。
   *
   * 未知 runId 回空清单而不是错误：一个已被淘汰 / 从未存在的 run 没有产物，这是一个
   * 事实而不是故障——同一姿态见事件日志对越界 cursor 的处理。
   */
  workflowRunArtifacts(rawParams: unknown): Promise<V4ConversationWorkflowRunArtifactsResult> {
    return this.engine.workflowRunArtifacts(rawParams);
  }
  /**
   * 预置看板的取数面：喂给某个产物的 `report` 条目分页。
   *
   * `limit` 的**缺省与钳制都在这里**（存储层精确兑现、绝不自造页大小也绝不再钳）；`hasMore` 照 workflowRunEvents 的惯例多取一条判定——判据绝不能是「这页正好满」，
   * 那会在条目数恰好等于 limit 时误报，让看板去翻一页不存在的数据。
   */
  workflowRunArtifactData(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunArtifactDataResult> {
    return this.engine.workflowRunArtifactData(rawParams);
  }
  /**
   * 内容产物的字节，**逐字照 attachmentRead**：一次一块、≤ 512 KiB（schema 已钉住 limit 的
   * 上界），`nextOffset` 为 null 即读到尾。
   *
   * **授权全在宿主侧**（端口实现）：该 run 必须属于 `sessionId` 这个会话 ∧ journal 里有
   * `(artifactId, version)` 的 completed 行，然后才拿**行上的** uri 去 store 读。网关只做
   * 参数校验与分块——它没有 journal，也不该有第二份授权判据（两处各判一次，同一个 id
   * 迟早会在两层上得到不同的解释）。宿主回 `undefined` = 无此版本 / 不是你的 run /
   * 这是块看板（没有字节），三者对调用方是同一个业务事实，这里归一成结构化的 not found。
   *
   * `offset` 越界不是错误：返回空块 + `nextOffset: null`，与读到尾同一形态。
   */
  workflowRunArtifactRead(
    rawParams: unknown,
  ): Promise<V4ConversationWorkflowRunArtifactReadResult> {
    return this.engine.workflowRunArtifactRead(rawParams);
  }
  /**
   * 工作区 transcript 的清单：一个 run 的
   * `files.*` / `git.*` / `world.run` 行，不带正文。
   *
   * 宿主回 `undefined`（未知 run / 不是你的 run）得到空清单而不是错误：与产物清单同一姿态，
   * 也是授权链「不告诉越权者猜对了哪一半」的要求。清单超过 maxNodes 截尾并置 `truncated`——
   * 一个循环里跑了三千次 `world.run` 的 run 不该把侧板撑爆。
   */
  workflowRunWorkspace(rawParams: unknown): Promise<V4ConversationWorkflowRunWorkspaceResult> {
    return this.engine.workflowRunWorkspace(rawParams);
  }
  /**
   * 一个工作区节点的正文，按 `maxBytes` 保形有界化（缺省与上限都是 resultMaxBytes，钳在这里）。
   * 授权全在宿主侧；宿主回 `undefined` = 无此节点 / 不是你的 run / 不是 world 行，归一成
   * 结构化的 not found。
   */
  workflowRunNodeResult(rawParams: unknown): Promise<V4ConversationWorkflowRunNodeResultResult> {
    return this.engine.workflowRunNodeResult(rawParams);
  }
  fileChanges(rawParams: unknown): Promise<V4ConversationFileChangesResult> {
    return this.engine.fileChanges(rawParams);
  }
  backgroundBashOutput(rawParams: unknown): Promise<BackgroundBashOutputResult> {
    return this.engine.backgroundBashOutput(rawParams);
  }
  fileRewindPreview(rawParams: unknown): Promise<V4ConversationFileRewindPreviewResult> {
    return this.engine.fileRewindPreview(rawParams);
  }
  /** begin 只 admission metadata，不解码/暂存 full payload。 */
  attachmentBegin(rawParams: unknown): Promise<V4AttachmentBeginResult> {
    return this.engine.attachmentBegin(rawParams);
  }
  attachmentChunk(rawParams: unknown): Promise<V4AttachmentChunkResult> {
    return this.engine.attachmentChunk(rawParams);
  }
  attachmentCommit(rawParams: unknown): Promise<V4AttachmentCommitResult> {
    return this.engine.attachmentCommit(rawParams);
  }
  attachmentAbort(rawParams: unknown): Promise<void> {
    return this.engine.attachmentAbort(rawParams);
  }
  attachmentRead(rawParams: unknown): Promise<V4AttachmentReadResult> {
    return this.engine.attachmentRead(rawParams);
  }
  conversationAttachmentRead(rawParams: unknown): Promise<V4ConversationAttachmentReadResult> {
    return this.engine.conversationAttachmentRead(rawParams);
  }
  conversationAttachmentStat(rawParams: unknown): Promise<V4ConversationAttachmentStatResult> {
    return this.engine.conversationAttachmentStat(rawParams);
  }
  attachmentPreviewSource(rawParams: unknown): Promise<V4AttachmentPreviewSourceResult> {
    return this.engine.attachmentPreviewSource(rawParams);
  }
  /** v4/conversation/unsubscribe。 */
  unsubscribe(rawParams: unknown): void {
    return this.engine.unsubscribe(rawParams);
  }
  /**
   * v4/command：inbox 六态裁决；accepted 时执行副作用并把终态随响应返回。
   *
   * 这里曾经"立即回初始 ACK、后台 settle"，
   * 导致 createSession/forkAssistant 的调用方拿不到 result.sessionId（settle 只回填
   * 幂等表，只有同 commandId 重试才能读到）——违反
   * 「accepted 即时带 result」。命令副作用本身是快返回的（sendPrompt 后台起 turn），
   * await 不会把 RPC 挂到整个 turn 结束，所以同步等待终态。
   * settle 仍然固化结果供 duplicate 重放。
   */
  handleCommand(rawParams: unknown): Promise<CommandAck> {
    return this.engine.handleCommand(rawParams);
  }
  /** v4/commands/query：同 key 与 handleCommand 共用 CommandInbox gate。 */
  queryCommands(rawParams: unknown): Promise<CommandsQueryResult> {
    return this.engine.queryCommands(rawParams);
  }
  getQueueItem(sessionId: string, queueItemId: string): QueueItem | null {
    return this.engine.getQueueItem(sessionId, queueItemId);
  }
  hasQueueItemKind(sessionId: string, kind: QueueItem["kind"]): boolean {
    return this.engine.hasQueueItemKind(sessionId, kind);
  }
  hasQueuedDelivery(sessionId: string, delivery: "guide" | "queue"): boolean {
    return this.engine.hasQueuedDelivery(sessionId, delivery);
  }
  getQueueLength(sessionId: string): number {
    return this.engine.getQueueLength(sessionId);
  }
  /** Resident 回收保护：publisher queue 与 CommandInbox pinned facts 任一存在都不可关闭。 */
  hasResidencyBlockingCommands(sessionId: string): boolean {
    return this.engine.hasResidencyBlockingCommands(sessionId);
  }
  getQueueHead(sessionId: string): {
    autoDrain: boolean;
    dispatchState: QueueItem["dispatch"]["state"];
    kind: QueueItem["kind"];
    queueItemId: string;
    text: string;
  } | null {
    return this.engine.getQueueHead(sessionId);
  }
  /**
   * 当前输入路由模式（v4 原生能力，供命令层 host.getInputRoutingMode 使用）：
   * held choice 裁决（heldQueueInputRequiresChoice）读投影 inputRouting.mode。
   */
  getInputRoutingMode(
    sessionId: string,
  ): "startNow" | "enqueue" | "guide" | "reject" | "choice" | null {
    return this.engine.getInputRoutingMode(sessionId);
  }
  getSessionFollowupMode(sessionId: string): "queue" | "guide" | null {
    return this.engine.getSessionFollowupMode(sessionId);
  }
  /**
   * rowId → 权威 messageId（v4 原生能力，供 forkAssistant/retryTurn 定位 assistant 行）。
   * 会话无 publisher / 行不存在 / 非 assistant 行 → null（命令层据此 reject，不静默兜底）。
   */
  getMessageIdForRow(sessionId: string, rowId: number): string | null {
    return this.engine.getMessageIdForRow(sessionId, rowId);
  }
  resolveRowActionTarget(
    sessionId: string,
    target: ConversationRowTarget,
    action: ConversationRowTargetAction,
  ) {
    return this.engine.resolveRowActionTarget(sessionId, target, action);
  }
  /** rowId → 所属 product turn 内所有 transcript messageId（文件摘要撤销 / diff 查询）。 */
  getMessageIdsForTurnRow(sessionId: string, rowId: number): string[] {
    return this.engine.getMessageIdsForTurnRow(sessionId, rowId);
  }
  /** fork 目标必须是所属轮最后一段 assistantText（无投影 → null，按未知处理）。 */
  isLatestAssistantSegmentRow(sessionId: string, rowId: number): boolean | null {
    return this.engine.isLatestAssistantSegmentRow(sessionId, rowId);
  }
  resolveStableForkCandidate(sessionId: string, rowId: number) {
    return this.engine.resolveStableForkCandidate(sessionId, rowId);
  }
  /** latestAssistantRetryOnly：retry 目标必须是全时间线最新且有 realUser cause 的 assistantText。 */
  isLatestRetryAssistantRow(sessionId: string, rowId: number): boolean | null {
    return this.engine.isLatestRetryAssistantRow(sessionId, rowId);
  }
  /** latestQueryEditOnly：edit 目标必须是当前投影里的最后一条 realUser userInput row。 */
  isLatestEditableUserRow(sessionId: string, rowId: number): boolean | null {
    return this.engine.isLatestEditableUserRow(sessionId, rowId);
  }
  /** rowId → product turnId（editUserQuery 无 assistant anchor 时回查 user messageId）。 */
  getTurnIdForRow(sessionId: string, rowId: number): string | null {
    return this.engine.getTurnIdForRow(sessionId, rowId);
  }
  /**
   * rowId → 所属 turn 的 rewind 锚点 messageId（供 editUserQuery：user 行无 messageId，
   * 用同 turn 内 assistant 行的 messageId 作 `/rewind` 目标）。
   */
  getTurnRewindAnchor(sessionId: string, rowId: number): string | null {
    return this.engine.getTurnRewindAnchor(sessionId, rowId);
  }
  /** 会话关闭：清 publisher 与其全部订阅调度；hydration 标记同清（重开走冷启动重建）；
   *  并从其 workspace index 移除该会话（session.removed 推给列表订阅者）。 */
  disposeSession(sessionId: string): void {
    return this.engine.disposeSession(sessionId);
  }
  /**
   * Resident 容量去激活：与 disposeSession 相同的内存运行态清理，但**不**从 sessions-index
   * 移除会话（不发 session.removed）——去激活是纯内存优化，侧边栏列表项必须原样
   * 保留，再次订阅经冷恢复透明重建。
   */
  deactivateSession(sessionId: string): void {
    return this.engine.deactivateSession(sessionId);
  }
  /**
   * Resident 回收纯预检：调用方可在拆 runtime event subscription 前拒绝不安全回收。
   * deactivateSession 内仍复用同一校验，防止未来新增调用方绕过执行面 preflight。
   */
  assertSessionRuntimeDeactivatable(sessionId: string): void {
    return this.engine.assertSessionRuntimeDeactivatable(sessionId);
  }
  /** Resident 回收判定：该会话是否还有 conversation 订阅者（桌面 tab / 手机 remote）。 */
  hasConversationSubscribers(sessionId: string): boolean {
    return this.engine.hasConversationSubscribers(sessionId);
  }
  /**
   * 内存诊断计数器。只读 size，不触碰状态。
   * detachedLive 用于观察子 session publisher 是否随父 session 释放。
   */
  collectMemoryDiagnostics(): Record<string, number> {
    return this.engine.collectMemoryDiagnostics();
  }
  dispose(): void {
    return this.engine.dispose();
  }
  /** 测试探针：立即排空某订阅（绕过定时器）。 */
  flushNow(subscriptionId: string): ConversationTopicFrame | null {
    return this.engine.flushNow(subscriptionId);
  }
}
export type { V4GatewayHost } from "./v4-gateway-v4-gateway-host.js";
export { V4CommandNotImplementedError } from "./v4-gateway-v4-command-not-implemented-error.js";
export { V4CommandNoopError } from "./v4-gateway-v4-command-not-implemented-error.js";
