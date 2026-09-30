import type {
  ModelNetworkStatusPayload,
  SessionEvent,
  StreamRecoveryRetryStartedPayload,
  StreamRecoveryStartedPayload,
} from "@mycode/contracts";

import type { ApiRetryState, ConversationDelta } from "@mycode/shared/mycode-protocol-v4";

import {
  positiveInteger,
  nonNegativeInteger,
  modelRetryReasonCode,
  streamRecoveryReasonCode,
} from "./product-projection-session-config-seed.js";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionNetworkStatus = {
  // ── 流式输出 ──

  onModelNetworkStatus(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    if (!this.acceptsActiveModelEvent(event)) return [];
    const payload = event.payload as ModelNetworkStatusPayload;
    switch (payload.type) {
      case "model_retry_scheduled": {
        const attempt = positiveInteger(payload.attempt, 1);
        const maxAttempts = Math.max(
          positiveInteger(payload.maxAttempts, attempt + 1),
          attempt + 1,
        );
        return this.setApiRetry({
          attempt,
          maxAttempts,
          nextRetryAt: this.ms(event) + nonNegativeInteger(payload.delayMs, 0),
          reasonCode: modelRetryReasonCode(payload.reason),
        });
      }
      case "model_request_started":
        if (payload.streamRecovery) {
          return this.setApiRetry(
            this.streamRecoveryApiRetry(
              payload.streamRecovery.retryNumber,
              payload.streamRecovery.maxRetries,
              this.ms(event),
              this.snapshot.control.apiRetry?.reasonCode ?? "fault.network.sseDisconnected",
            ),
          );
        }
        // adapter attempt=2+ 只说明重试请求已发出，不代表连接恢复；
        // 保持当前状态，等首个有效 text/reasoning/tool 进展再清理，避免标签闪退。
        return positiveInteger(payload.attempt, 1) <= 1 ? this.setApiRetry(null) : [];
      case "model_request_completed":
        return this.setApiRetry(null);
      case "model_request_failed":
        return payload.retryable ? [] : this.setApiRetry(null);
      case "model_stream_stalled":
      case "model_first_provider_event":
      case "model_first_content":
      case "model_first_text":
      // 准入等待的两端是 runtime 观测，不是 UI 状态：
      // 不映射成重试/等待标签。
      case "model_request_queued":
      case "model_request_admitted":
        return [];
    }
  },
  onStreamRecoveryStarted(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    if (!this.acceptsActiveModelEvent(event)) return [];
    const payload = event.payload as StreamRecoveryStartedPayload;
    return this.setApiRetry(
      this.streamRecoveryApiRetry(
        payload.retryNumber,
        payload.maxRetries,
        this.ms(event),
        streamRecoveryReasonCode(payload.failureKind),
      ),
    );
  },
  onStreamRecoveryTailDiscarded(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    if (!this.acceptsActiveModelEvent(event)) return [];
    // Bug 原因：Core 已用 tail_discarded 切断失败 assistant attempt，但旧 V4 投影忽略该事件，
    // 下一次 reasoning/text 到达时会把旧行误收口为 complete。这里必须先标 interrupted，
    // 让恢复流用新 assistant identity 打开新行，避免 UI 看起来像一次连续完整输出。
    // Bug 原因：断流时已由 tool_input_start 打开、但还没等到 tool_call 定稿的工具行也属于
    // 被作废的 tail——core 只为已提交的工具合成终态，这些行没人收口；恢复请求会用新的
    // toolCallId 再开一行，UI 于是并排出现两张「正在编写工作流」。已提交（running /
    // pendingApproval）的行不在此列，它们的终态由 executor 自己发布。
    return [
      ...this.closeStreamingRows("interrupted"),
      ...this.closeOpenToolRows(event, "cancelled", (row) => row.status === "inputStreaming"),
    ];
  },
  onStreamRecoveryRetryStarted(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    if (!this.acceptsActiveModelEvent(event)) return [];
    const payload = event.payload as StreamRecoveryRetryStartedPayload;
    return this.setApiRetry(
      this.streamRecoveryApiRetry(
        payload.retryNumber,
        payload.maxRetries,
        this.ms(event),
        this.snapshot.control.apiRetry?.reasonCode ?? "fault.network.sseDisconnected",
      ),
    );
  },
  streamRecoveryApiRetry(
    this: ProjectionEngine,
    retryNumber: number,
    maxRetriesValue: number,
    nextRetryAt: number,
    reasonCode: string,
  ): ApiRetryState {
    const attempt = positiveInteger(retryNumber, 1);
    const maxRetries = Math.max(positiveInteger(maxRetriesValue, attempt), attempt);
    return {
      attempt,
      maxAttempts: maxRetries + 1,
      nextRetryAt,
      reasonCode,
    };
  },
  setApiRetry(this: ProjectionEngine, apiRetry: ApiRetryState | null): ConversationDelta[] {
    const current = this.snapshot.control.apiRetry;
    if (
      current === apiRetry ||
      (current !== null &&
        apiRetry !== null &&
        current.attempt === apiRetry.attempt &&
        current.maxAttempts === apiRetry.maxAttempts &&
        current.nextRetryAt === apiRetry.nextRetryAt &&
        current.reasonCode === apiRetry.reasonCode)
    ) {
      return [];
    }
    return [
      {
        op: "state.updated",
        patch: this.controlPatch({ apiRetry }),
      },
    ];
  },
  acceptsActiveModelEvent(this: ProjectionEngine, event: SessionEvent): boolean {
    if (!this.isRunning()) return false;
    // stop/新一轮后旧请求可能迟到；仅凭 session 级状态会让旧 turn 的
    // retry/progress 覆盖当前输入栏。当前 runtime turn 已知时必须按 turnId 隔离。
    return (
      this.currentTurnId === null ||
      event.turnId === undefined ||
      String(event.turnId) === this.currentTurnId
    );
  },
};
export type ProjectionNetworkStatusMethods = typeof projectionNetworkStatus;
