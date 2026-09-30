import {
  type MyCodeContextUsageBreakdownItem,
  type MyCodePendingPermission,
  type MyCodeSessionContextUsage,
  type MyCodeSessionGoal,
  type MyCodeSessionProjection,
} from "@mycode/shared";
import {
  type MessageWithParts,
  type PendingPermission,
  type SessionGoal,
  type SessionProjection,
} from "@mycode/contracts";
import {
  buildProtocolPermissionOptions,
  toLegacyPermissionOptionsPolicy,
} from "./permission-options.js";
import {
  mapActiveToolCall,
  mapBackgroundTask,
} from "./session-mapper-snapshot-inline-image-data-url-max-bytes.js";

export function mapSessionProjection(projection: SessionProjection): MyCodeSessionProjection {
  return {
    activeToolCalls: projection.activeToolCalls.map(mapActiveToolCall),
    backgroundJobs: projection.backgroundTasks.map(mapBackgroundTask),
    contextUsed: projection.contextUsed,
    contextWindow: projection.contextWindow,
    currentTurnId: projection.currentTurnId ? String(projection.currentTurnId) : undefined,
    lastError: projection.lastError,
    mode: projection.mode,
    pendingPermissions: projection.pendingPermissions.map(mapPendingPermission),
    sessionId: String(projection.id),
    status: projection.status,
    target: mapSessionGoal(projection.target),
    totalTokenCount: projection.totalTokenCount,
    turnCount: projection.turnCount,
  };
}

export interface ContextUsageBreakdownCandidate {
  breakdown: MyCodeContextUsageBreakdownItem[];
  contextWindow?: number;
  used: number;
}

export function applyContextUsageBreakdown(
  contextUsage: MyCodeSessionContextUsage | undefined,
  candidate: ContextUsageBreakdownCandidate | undefined,
): MyCodeSessionContextUsage | undefined {
  if (!contextUsage || !candidate || candidate.breakdown.length === 0) {
    return contextUsage;
  }
  if (contextUsage.breakdown && contextUsage.breakdown.length > 0) {
    return contextUsage;
  }
  if (candidate.used !== contextUsage.used) {
    return contextUsage;
  }
  if (candidate.contextWindow !== undefined && candidate.contextWindow !== contextUsage.size) {
    return contextUsage;
  }
  return {
    ...contextUsage,
    breakdown: candidate.breakdown,
  };
}

export function contextUsageFromProjection(
  projection: SessionProjection,
  cache: MyCodeSessionContextUsage["cache"] | undefined,
): MyCodeSessionContextUsage | undefined {
  if (projection.contextUsed <= 0 || projection.contextWindow <= 0) {
    return undefined;
  }
  return {
    ...(cache ? { cache } : {}),
    cost: null,
    size: projection.contextWindow,
    used: projection.contextUsed,
  };
}

export function contextUsageFromPersistedMessages(
  messages: readonly MessageWithParts[],
  contextWindow: number,
): MyCodeSessionContextUsage | undefined {
  if (contextWindow <= 0) {
    return undefined;
  }
  const cache = contextCacheUsageFromMessages(messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.info.role === "user" && message.info.summary) {
      const compactPart = message.parts.find(
        (part) => part.type === "compaction" && part.compactBoundary,
      );
      if (compactPart?.type === "compaction" && compactPart.compactBoundary) {
        const used = positiveInteger(
          compactPart.compactBoundary.truePostCompactTokenCount ??
            compactPart.compactBoundary.postCompactTokenCount,
        );
        // 成功 compact 的 usage 持久化在 user summary 的 boundary；
        // 只扫描 assistant 会越过它并恢复压缩前水位。旧 assistant boundary 和
        // 不完整历史仍走原有 fallback，且不能把压缩前 cache 重新挂到压缩后水位。
        if (used !== undefined) {
          return {
            cost: null,
            size: contextWindow,
            used,
          };
        }
      }
    }
    if (message.info.role !== "assistant" || message.info.summary) {
      continue;
    }
    const used = contextUsedFromTokens(message.info.tokens);
    if (used === undefined) {
      continue;
    }
    // protocol eventStore 是运行期内存账本，重启 resume 后 projection.contextUsed 会回到 0。
    // context window 消耗是 input + output；恢复时优先用 provider total，否则用持久化的 input/output 还原 meter。
    return {
      ...(cache ? { cache } : {}),
      cost: null,
      size: contextWindow,
      used,
    };
  }
  return undefined;
}

export function contextUsedFromTokens(
  tokens:
    | {
        total?: number;
        input: number;
        output?: number;
      }
    | undefined,
): number | undefined {
  if (!tokens) {
    return undefined;
  }

  const total = positiveInteger(tokens.total);
  if (total !== undefined) {
    return total;
  }

  const input = positiveInteger(tokens.input);
  if (input === undefined) {
    return undefined;
  }

  return input + (nonNegativeInteger(tokens.output) ?? 0);
}

export function contextCacheUsageFromMessages(
  messages: readonly MessageWithParts[],
): MyCodeSessionContextUsage["cache"] | undefined {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let requestCount = 0;
  let latestInputTokens = 0;
  let latestCacheReadTokens = 0;
  let latestCacheWriteTokens = 0;

  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.summary) {
      continue;
    }
    const input = nonNegativeInteger(message.info.tokens.input) ?? 0;
    const read = nonNegativeInteger(message.info.tokens.cache.read) ?? 0;
    const write = nonNegativeInteger(message.info.tokens.cache.write) ?? 0;
    if (input <= 0 && read <= 0 && write <= 0) {
      continue;
    }
    requestCount += 1;
    inputTokens += input;
    cacheReadTokens += read;
    cacheWriteTokens += write;
    latestInputTokens = input;
    latestCacheReadTokens = read;
    latestCacheWriteTokens = write;
  }

  if (requestCount <= 0) {
    return undefined;
  }
  return {
    inputTokens: latestInputTokens,
    cacheReadTokens: latestCacheReadTokens,
    cacheWriteTokens: latestCacheWriteTokens,
    latestHitRate: latestInputTokens > 0 ? latestCacheReadTokens / latestInputTokens : null,
    hitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
    hitRateRequestCount: requestCount,
    totalInputTokens: inputTokens,
    totalCacheReadTokens: cacheReadTokens,
    totalCacheWriteTokens: cacheWriteTokens,
  };
}

export function mapPendingPermission(permission: PendingPermission): MyCodePendingPermission {
  // display / optionsPolicy 刻意不进 legacy v3 输出。
  // 根因不是"扩 schema 只能单向兼容"，而是 strict schema 随 packages/shared 打进每个桌面端
  // 的产物：今天把 mycodePendingPermissionSchema（shared/src/mycode-protocol/index.ts:1139）和
  // mycodePermissionRequestedEventPayloadSchema（同文件:1536）改成可选，也保护不了已经装出去
  // 的旧桌面。新 CLI 一旦在 v3 路径上带这两个字段，旧桌面会整份快照解析失败、并用 safeParse
  // 静默丢弃整个 permission.requested 事件——确认窗本身就没了，这违反"只允许预览降级、
  // 不允许 gate 降级"。剥离在源头是唯一对版本偏斜安全的做法；legacy 也没有画因果图的界面。
  // optionsPolicy 的效果仍然生效：它作为 buildProtocolPermissionOptions 的输入裁掉
  // allow_always，只有裁剪后的 options 列表过协议。会话免确认同样降级为裁剪：
  // 旧桌面回传的是 response 原文，认不出会话语义（见 toLegacyPermissionOptionsPolicy）。
  return {
    input: permission.input,
    ...(permission.origin ? { origin: permission.origin } : {}),
    options: buildProtocolPermissionOptions({
      ...permission,
      optionsPolicy: toLegacyPermissionOptionsPolicy(permission.optionsPolicy),
    }),
    reason: permission.reason ?? "",
    requestId: permission.requestId ?? permission.toolCallId,
    requestedAt: permission.requestedAt.getTime(),
    riskLevel: permission.riskLevel,
    toolCallId: permission.toolCallId,
    toolName: permission.toolName,
  };
}

export function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function mapSessionGoal(
  goal: SessionGoal | null | undefined,
): MyCodeSessionGoal | null | undefined {
  if (goal === undefined) return undefined;
  if (goal === null) return null;
  return {
    createdAt: goal.time.created,
    objective: goal.objective,
    sessionId: String(goal.sessionID),
    status: goal.status,
    summaryTitle: goal.summaryTitle,
    targetId: goal.targetID,
    timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? 0,
    activeInputId: goal.activeInputId ?? null,
    activeRunStartedAtMs: goal.activeRunStartedAtMs ?? null,
    activeRunLastSeenAtMs: goal.activeRunLastSeenAtMs ?? null,
    updatedAt: goal.time.updated,
  };
}
