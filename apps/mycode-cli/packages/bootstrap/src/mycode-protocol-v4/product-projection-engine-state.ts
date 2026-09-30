import type {
  CuaAppIdentity,
  ConversationSnapshot,
  MutableConversationSnapshotAccumulator,
} from "@mycode/shared/mycode-protocol-v4";

import { createInitialConversationSnapshot } from "./projection-state.js";
import { type ConversationNormalizationDiagnostic } from "./event-normalizer.js";

import {
  type FileToolInputPreviewState,
  type PendingSessionHookInvocation,
  type ConversationEditTarget,
  type ContextWindowProjectionState,
  type TurnModelBaseline,
} from "./product-projection-session-config-seed.js";

/** 唯一可变投影状态；仅在内部 engine 使用，公开 ProductProjection 不暴露这些字段。 */
export class ProjectionEngineState {
  snapshot: ConversationSnapshot;
  // reducer 内部的 rowId 查找必须与 rows.window 同步；冷恢复过去每次 find 都扫描全表，
  // tool/turn 终态越多退化越明显。普通归约增量维护，rewind 才重建。
  rowIndexById = new Map<number, number>();
  hydrationAccumulator: MutableConversationSnapshotAccumulator | null = null;
  nextRowId = 1;
  streamingTextRowId: number | null = null;
  streamingReasoningRowId: number | null = null;
  // output-token Continue 是同一 product turn 内的请求级恢复，不应泄漏成新的正文行。
  // 这里只保留上一条满足 length/zero-tool/视觉紧邻条件的 text row，任何真实边界都会清空。
  outputContinuationTextRowId: number | null = null;
  toolRowIdByCallId = new Map<string, number>();
  latestListAppsSnapshot = new Map<number, CuaAppIdentity>();
  // snapshot 是权威状态；该 Set 只是 TurnComplete 缺终态兜底的派生索引，避免每轮扫描全表。
  openForegroundToolCallIds = new Set<string>();
  fileToolInputPreviewByCallId = new Map<string, FileToolInputPreviewState>();
  subagentRowIdByAgentId = new Map<string, number>();
  hookRowIdByInvocationId = new Map<string, number>();
  // resume SessionStart 没有 turnId；先保留在 CLI projection，下一条真实 user-intent
  // TurnStarted 到达后再分配 rowId/turnId。不得构造 session-hooks:* synthetic turn。
  pendingSessionHookInvocations = new Map<string, PendingSessionHookInvocation>();
  // rewind 后 async Hook 的 terminal 仍可能迟到；保留 invocation 墓碑，避免被删旧分支
  // 因找不到原 row 而被 terminal-only 兼容路径重新 append。
  rewoundHookInvocationIds = new Set<string>();
  // 冷恢复 transcript 可能含旧版本先发布、后持久化失败的 ghost child。store seed 后
  // 必须持续排除，而不是只覆盖一次 snapshot；否则下一条无关事件会从历史 row 再物化它。
  invalidSubagentChildSessionIds = new Set<string>();
  // rowId → 权威 messageId 侧表。forkAssistant/editUserQuery 的命令载荷用 rowId
  // 定位，但旧 fork/rewind operations 用 messageId（history target）——桥接层经本表翻译。
  // 不进 row schema（客户端只发 rowId，messageId 是服务端内部锚点，避免污染冻结的行结构）。
  messageIdByRowId = new Map<number, string>();
  // Continue 复用 rowId 后，动作锚点推进到最后一条 assistant message；旧 partial messageId
  // 仍需能命中同一 row，供 compact coverage、rewind 和整轮文件事实恢复使用。
  outputContinuationRowIdByMessageId = new Map<string, number>();
  entityIdByRowId = new Map<number, string>();
  // canonical command target 只按稳定实体身份寻址；rowId 仅是本次 materialization 的
  // transient lookup，刷新/replay 后变化也不会改变 target identity。
  editTargetByEntityId = new Map<string, ConversationEditTarget>();
  currentEditableEntityId: string | null = null;
  stableCompactCoverageBoundaryRowId: number | null = null;
  turnHeaderRowIdByTurnId = new Map<string, number>();
  compactMarkerRowIdByOperationId = new Map<string, number>();
  // goal verify boundary 身份 = targetId_goalIteration
  // （verificationId 仅 attempt alias——同 iteration 重试携带新 verificationId，
  // 旧实现按 verificationId keying 会长出第二个 marker）。
  goalVerifyMarkerRowIdByLifecycleKey = new Map<string, number>();
  // queue drain 在同一 runtimeTurn 内切出新的
  // product turn。runtimeTurnId → 当前 productTurnId 映射；后续事件行经 turnIdOf
  // 归入最新 productTurn。steer（guide）不切轮，内联当前轮。
  productTurnIdByRuntimeTurnId = new Map<string, string>();
  runtimeTurnIdByProductTurnId = new Map<string, string>();
  productTurnSplitOrdinalByRuntimeTurnId = new Map<string, number>();
  currentProductTurnStartedAtMs: number | null = null;
  // 投递语义侧表：TurnSteerQueued 时按事件 payload（或 followupMode 兜底）记录，
  // drain 时决定切轮 vs 内联；账本落地后以账本为准。
  deliveryByPendingInputId = new Map<string, "guide" | "queue">();
  currentTurnId: string | null = null;
  // 当前 runtime turn 是否由 model-only TurnStarted 建立（manual /compact、
  // goal continuation 等维护 turn）。SessionStart 摘要的 pending 归位不得以维护
  // turn 为收口目标，必须等下一条 user-visible 真实 turn。
  currentTurnStartedModelOnly = false;
  // contextWindow=null 时协议不暴露分母与已用量，但 reducer 仍需保留最新 context 用量，
  // 以便 registry 后续恢复已知容量时原子重建 usage，而不是错误归零。
  contextWindowState: ContextWindowProjectionState = {
    maxTokens: null,
    touchedByEvent: false,
    usedTokens: 0,
  };
  // modelChange marker 在「下一个 turn 开始时」生成。
  // silentInitial 保持普通 Main 首轮静默；sourceLess 表示显式 ∅→X；known 保存上一轮
  // 实际使用的 provider/model。thought 只随基线记录，不触发模型身份变化。
  lastTurnModel: TurnModelBaseline = { kind: "silentInitial" };
  // 种子守卫：事件（权威日志）触碰过的 config 区块不再接受种子覆盖。
  configModelTouchedByEvent = false;
  // 旧 ModelSelected 不含能力集合；独立守卫允许 runtime seed 补齐旧日志，
  // 又避免后续种子覆盖新事件已原子发布的模型能力。
  configThoughtLevelsTouchedByEvent = false;
  configModeTouchedByEvent = false;
  // assistant 守恒：非运行期拒收的正文流计数（gateway 据此置 stale）。
  droppedContentStreamEventCount = 0;
  // 读取期 legacy fallback 必须可观测；否则 normalizer 缺字段后仍会退化为“可见但不可寻址”。
  normalizationDiagnostics: ConversationNormalizationDiagnostic[] = [];
  constructor(sessionId: string, logEpoch: string) {
    this.snapshot = createInitialConversationSnapshot(sessionId, logEpoch);
  }
}
