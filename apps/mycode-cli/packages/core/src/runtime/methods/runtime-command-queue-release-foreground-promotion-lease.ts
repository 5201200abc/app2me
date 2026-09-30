import type { AgentRuntimeInternal } from "../internal.js";
import type {
  StopActiveForegroundExecutionOptions,
  StopActiveForegroundExecutionResult,
} from "../types.js";

export function releaseForegroundPromotionLease(
  this: AgentRuntimeInternal,
  leaseId: string,
): boolean {
  if (this.foregroundPromotionLease?.leaseId !== leaseId) return false;
  this.foregroundPromotionLease = undefined;
  // 启动前失败时 B 可能已在 lease 后等待；释放必须主动恢复 drain，不能等下一条 enqueue。
  void this.drainRuntimeCommandQueue();
  return true;
}

export function stopActiveForegroundExecution(
  this: AgentRuntimeInternal,
  options: StopActiveForegroundExecutionOptions = {},
): StopActiveForegroundExecutionResult {
  const active = this.activeForegroundExecution;
  if (!active || active.controller.signal.aborted) {
    return { kind: "idle" };
  }
  if (
    options.expectedForegroundExecutionId !== undefined &&
    options.expectedForegroundExecutionId !== active.foregroundExecutionId
  ) {
    return {
      kind: "mismatch",
      activeForegroundExecutionId: active.foregroundExecutionId,
    };
  }
  // sendQueuedNow 的内部抢占过去与用户手动 Stop 共用同一种 cancelled，
  // turn catch 因而把 queueAutoDrain 关闭。把调用意图固定在当前 foreground
  // execution 上，保证超时后迟到的 TurnComplete 仍能保留原队列授权。
  active.preserveQueueAutoDrainOnCancel = options.preserveQueueAutoDrainOnCancel === true;
  active.controller.abort(new Error(options.reason ?? "foreground execution stopped"));
  return {
    kind: "stopped",
    foregroundExecutionId: active.foregroundExecutionId,
  };
}

export function getActiveForegroundExecutionId(this: AgentRuntimeInternal): string | undefined {
  return this.activeForegroundExecution?.foregroundExecutionId;
}
