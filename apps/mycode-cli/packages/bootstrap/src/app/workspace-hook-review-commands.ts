import {
  SessionEventType,
  type WorkspaceHookBundleSnapshot,
  type WorkspaceHookReasonCode,
} from "@mycode/contracts";
import {
  WorkspaceHookReviewFlowRegistry,
  type WorkspaceHookReviewFlow,
  type WorkspaceHookReviewTarget,
  type WorkspaceHookRuntimeAdmissionPort,
  type WorkspaceHookTrustCoordinator,
} from "@mycode/core";
import type {
  WorkspaceHookReviewDecision,
  WorkspaceHookReviewRequestPayload,
} from "@mycode/shared/mycode-protocol-v4";
import { WorkspaceHookMutationError } from "@mycode/shared/workspace-hook-mutation";
import type {
  WorkspaceHookReviewCommandResult,
  WorkspaceHookReviewHostPort,
  WorkspaceHookReviewMutationPort,
} from "./workspace-hook-review-types.js";

import { WorkspaceHookReviewTelemetry } from "./workspace-hook-review-telemetry.js";

export interface WorkspaceHookReviewCommandContext {
  readonly admission: WorkspaceHookRuntimeAdmissionPort;
  readonly coordinator: WorkspaceHookTrustCoordinator;
  readonly registry: WorkspaceHookReviewFlowRegistry;
  readonly host: WorkspaceHookReviewHostPort;
  readonly telemetry: WorkspaceHookReviewTelemetry;
  readonly mutation: WorkspaceHookReviewMutationPort;
  readonly sessionId: string;
  applyPersistentTrust(reviewItemIds: readonly string[]): Promise<{ grantedRecordCount?: number }>;
  refreshPendingFlow(
    snapshot: WorkspaceHookBundleSnapshot,
  ): Promise<WorkspaceHookReviewFlow | undefined>;
  emitAdmissionUpdatedAfterMutation(): Promise<void>;
}
export async function respondToWorkspaceHookReview(
  context: WorkspaceHookReviewCommandContext,
  target: WorkspaceHookReviewTarget,
  decision: WorkspaceHookReviewDecision,
): Promise<WorkspaceHookReviewCommandResult> {
  const validation = context.registry.validate(target, decision);
  if (!validation.accepted) {
    context.telemetry.responseRejected(target, validation.reasonCode);
    return validation;
  }
  const flow = context.registry.getCurrentFlow(context.sessionId);
  if (!flow) {
    return {
      accepted: false,
      reasonCode: "workspace_hooks_review_superseded" as const,
    };
  }
  const snapshot = context.admission.getCurrentSnapshot();
  // request 绑定打开时的 immutable snapshot bundle。今天
  // replaceSnapshot 只有 toggle 一个合法调用方（经 refreshPendingFlow supersede 旧
  // flow），等价校验靠这一隐式不变量；配置热监听 watcher 一旦成为第二
  // 个调用方且绕过 refreshPendingFlow，tombstone 缺失会让授权落到新 bundle 上。
  // 与 revokeCurrent 对齐显式校验，消除隐式依赖。
  if (
    target.workspaceIdentity !== snapshot.workspaceIdentity ||
    target.bundleDigest !== snapshot.bundleDigest
  ) {
    context.telemetry.responseRejected(target, "workspace_hooks_snapshot_mismatch");
    return {
      accepted: false,
      reasonCode: "workspace_hooks_snapshot_mismatch" as const,
    };
  }
  // grant 前显式检查 persistent Trust 的 policy 资格：applyDecision 内
  // assertPersistentTrustMutationAllowed 抛出的策略拒绝若落入下方 catch-all，
  // 会被一律报成 trust_store_corrupt（“信任存储损坏”），企业策略收紧时
  // 用户看到的是错误诊断；与 revoke 路径对齐：前置检查 + 精确 reasonCode。
  if (!context.coordinator.canMutatePersistentTrust(snapshot.workspaceIdentity)) {
    context.telemetry.responseRejected(target, "workspace_hooks_blocked_by_policy");
    return {
      accepted: false,
      reasonCode: "workspace_hooks_blocked_by_policy" as const,
    };
  }
  let applied: { grantedRecordCount?: number };
  try {
    applied = await context.applyPersistentTrust(validation.reviewItemIds);
  } catch (error) {
    // applyDecision 可因非存储原因抛错——resolveWorkspaceHookReviewDigests
    // 对未知 reviewItemId、coordinator 内部错误、store 落盘失败等。裸 catch 会把全部
    // 失败一律报成 trust_store_corrupt 且把原始错误彻底丢弃，与 toggle 路径同类。
    // reasonCode 不变（新增需 contracts 评审），仅把
    // errorMessage 透传进 telemetry 供回溯。
    //
    // 脱敏：WorkspaceHookMutationError 的 message 已在上游脱敏
    // （见 workspace-hook-review-mutation.ts 使用 workspaceIdentitySummary / digestSummary）。
    // 对任意 Error 仅取 error.message——上游抛错点必须保证消息不含绝对路径/完整 digest
    // （禁止上报完整 workspace path / source path）。
    context.telemetry.trustStoreFailure(
      target.bundleDigest,
      error instanceof Error ? error.message : String(error),
    );
    return {
      accepted: false,
      reasonCode: "workspace_hooks_trust_store_corrupt" as const,
    };
  }
  context.telemetry.decisionAccepted(target, decision, {
    ...(applied.grantedRecordCount === undefined
      ? {}
      : { grantedRecordCount: applied.grantedRecordCount }),
    requestEnabledCount: flow.request.items.filter((item) => item.configuredEnabled).length,
  });
  const resolved = context.registry.resolve(target, decision);
  // applyDecision 与 registry.resolve 非原子——两者之间若
  // registry 的 deadline timer 恰好触发，flow 变为 timed_out，resolve 返回
  // superseded，于是「Trust 已落盘」却回报「审核已过期」。用户据此重试、排障者
  // 据此以为没写成功——同样属于错误归属倒错。
  //
  // 决策已经生效（持久 Trust 已落盘），故按 accepted 回报并照发
  // Settled，让前端收敛到已决状态；resolve 被拒仅说明 flow 已被别的终态占用，
  // 不代表授权失败。此处只多不错：不会把未授权说成已授权。
  if (!resolved.accepted) {
    // 保留观测：flow 已被别的终态占用（通常是 deadline 恰好触发）。
    context.telemetry.responseRejected(target, resolved.reasonCode);
  }
  await context.host.emit({
    type: SessionEventType.WorkspaceHookReviewSettled,
    payload: { interactionId: target.interactionId, state: "resolved" },
  });
  // 软门禁:settle 后重新评估 pending 状态,通知投影层更新提示条
  await context.emitAdmissionUpdatedAfterMutation();
  // 行内逐条 Trust 不能让其他待审项一起失去操作入口。旧 generation settle 后，
  // 若仍有 pending 声明，立即发布下一 immutable generation；已信任行由 Settings
  // 刷新后消失，其他行继续可操作。
  await context.refreshPendingFlow(snapshot);
  return resolved.accepted
    ? resolved
    : {
        accepted: true as const,
        reviewItemIds: [...validation.reviewItemIds],
      };
}

export async function toggleWorkspaceHookReviewItem(
  context: WorkspaceHookReviewCommandContext,
  target: WorkspaceHookReviewTarget,
  reviewItemId: string,
  enabled: boolean,
): Promise<
  WorkspaceHookReviewCommandResult & {
    request?: WorkspaceHookReviewRequestPayload;
  }
> {
  const validation = context.registry.validate(target, {
    action: "trust_selected",
    reviewItemIds: [reviewItemId],
  });
  if (!validation.accepted) return validation;
  const currentSnapshot = context.admission.getCurrentSnapshot();
  const entry = currentSnapshot.hooks.find((item) => item.reviewItemId === reviewItemId);
  if (!entry?.editable) {
    return {
      accepted: false,
      reasonCode: "workspace_hooks_snapshot_mismatch" as const,
    };
  }
  let writeCommitted = false;
  let nextSnapshot: WorkspaceHookBundleSnapshot;
  try {
    nextSnapshot = await context.mutation.toggle(
      { snapshot: currentSnapshot, reviewItemId, enabled },
      () => {
        writeCommitted = true;
        context.admission.invalidate("workspace_hooks_config_rebuild_failed");
      },
    );
    context.admission.replaceSnapshot(nextSnapshot);
  } catch (error) {
    if (!writeCommitted) {
      // 裸 catch 曾把 mutation port 的全部失败一律报成
      // config_write_failed——包括发生在写盘之前的 snapshot mismatch（review 后
      // bundle 已变/discovery 读败）。用户据此重试"写"永远失败，也掩盖真实原因。
      // 按 WorkspaceHookMutationError.code 透传；telemetry 补 cause 便于定位。
      const isMutationError =
        error instanceof WorkspaceHookMutationError ||
        (error instanceof Error && error.name === "WorkspaceHookMutationError");
      const mutationCode = isMutationError
        ? ((error as WorkspaceHookMutationError).code as WorkspaceHookReasonCode)
        : ("workspace_hooks_config_write_failed" as const);
      context.telemetry.toggleFailure(
        target.bundleDigest,
        mutationCode,
        error instanceof Error ? error.message : String(error),
      );
      return {
        accepted: false,
        reasonCode: mutationCode as WorkspaceHookReasonCode,
      };
    }
    context.telemetry.toggleFailure(target.bundleDigest, "workspace_hooks_config_rebuild_failed");
    context.registry.fail(target, "workspace_hooks_config_rebuild_failed");
    await context.host.emit({
      type: SessionEventType.WorkspaceHookReviewSettled,
      payload: {
        interactionId: target.interactionId,
        state: "configuration_error",
        reasonCode: "workspace_hooks_config_rebuild_failed",
      },
    });
    return {
      accepted: false,
      reasonCode: "workspace_hooks_config_rebuild_failed" as const,
    };
  }

  const nextFlow = await context.refreshPendingFlow(nextSnapshot);
  // 软门禁:toggle 重建 bundle 后重新评估 pending 状态
  await context.emitAdmissionUpdatedAfterMutation();
  return {
    accepted: true,
    reviewItemIds: [reviewItemId],
    ...(nextFlow ? { request: nextFlow.request } : {}),
  };
}
