import { traceContextToLogContext } from "../deps.js";
import type { RuntimeCommand, TaskNotificationRuntimeCommand } from "../command-queue.js";
import { uuidv7 } from "@mycode/shared";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  persistBackgroundTaskNotificationBatch,
  shouldSuppressTaskNotificationRuntimeCommand,
} from "./background-notifications.js";
import { runActiveTargetContinuationLoop } from "./target-continuation-loop.js";
import { isStaleBranchRuntimeCommand } from "./runtime-command-generation.js";
import type {
  AcquireForegroundPromotionLeaseResult,
  ActiveForegroundExecutionState,
  ForegroundPromotionLeaseMode,
} from "../types.js";

export function enqueueRuntimeCommand(this: AgentRuntimeInternal, command: RuntimeCommand): void {
  this.runtimeCommandQueue.enqueue(command);
  if (command.mode === "task-notification") {
    this.logger?.info?.("Background task notification enqueued into runtime command queue", {
      ...traceContextToLogContext(command.traceContext),
      commandId: command.id,
      event: "background_task.notification.runtime_enqueued",
      module: "core.runtime",
      queueSize: this.runtimeCommandQueue.size(),
    });
  }
  void this.drainRuntimeCommandQueue();
}

export function dequeueNextRunnableBatch(this: AgentRuntimeInternal): readonly RuntimeCommand[] {
  const lease = this.foregroundPromotionLease;
  if (!lease) return this.runtimeCommandQueue.dequeueNextBatch();

  const promotedCommand = this.runtimeCommandQueue
    .snapshot()
    .find((command) => runtimeCommandInputId(command) === lease.promotedInputId);
  if (!promotedCommand) return Object.freeze([]);
  const removedPromotedCommand = this.runtimeCommandQueue.removeById(promotedCommand.id);
  if (!removedPromotedCommand) return Object.freeze([]);

  // sendQueuedNow 过去在 Stop A 与 promoted command 入队之间没有 Core
  // 调度所有权，notification B 会抢先出队。匹配 command 出队与 lease 消费必须同一同步步。
  this.foregroundPromotionLease = undefined;
  return Object.freeze([removedPromotedCommand]);
}

export function runtimeCommandInputId(command: RuntimeCommand): string | undefined {
  if (
    command.mode === "prompt" ||
    command.mode === "target-continuation" ||
    command.mode === "target-continuation-loop"
  ) {
    return command.options?.inputId;
  }
  return undefined;
}

export function hasActiveOrQueuedTurnWork(this: AgentRuntimeInternal): boolean {
  return (
    this.foregroundPromotionLease !== undefined ||
    this.activeForegroundExecution !== undefined ||
    this.runtimeCommandDrainActive ||
    this.runtimeCommandQueue.hasPending() ||
    this.activeTurn !== undefined ||
    this.activeTurnStartReservation !== undefined
  );
}

export function acquireForegroundPromotionLease(
  this: AgentRuntimeInternal,
  options: {
    leaseId: string;
    mode: ForegroundPromotionLeaseMode;
    promotedInputId: string;
  },
): AcquireForegroundPromotionLeaseResult {
  const existing = this.foregroundPromotionLease;
  if (existing) {
    return existing.leaseId === options.leaseId
      ? { kind: "acquired", leaseId: existing.leaseId }
      : { kind: "conflict", leaseId: existing.leaseId };
  }
  if (
    options.mode === "idle-only" &&
    (this.activeForegroundExecution !== undefined ||
      this.runtimeCommandDrainActive ||
      this.runtimeCommandQueue.hasPending() ||
      this.activeTurn !== undefined ||
      this.activeTurnStartReservation !== undefined)
  ) {
    return { kind: "busy" };
  }
  this.foregroundPromotionLease = {
    leaseId: options.leaseId,
    promotedInputId: options.promotedInputId,
  };
  return { kind: "acquired", leaseId: options.leaseId };
}

export async function runPostCommandActiveTargetLoop(
  this: AgentRuntimeInternal,
  command: RuntimeCommand,
  abortSignal: AbortSignal,
): Promise<Awaited<ReturnType<AgentRuntimeInternal["continueActiveTargetLoop"]>> | null> {
  if (command.mode === "prompt" && command.options?.continueActiveTargetAfterTurn === true) {
    return await runActiveTargetContinuationLoop.call(this, {
      abortSignal,
      inputId: command.options.inputId,
      traceContext: command.options.traceContext ?? command.traceContext,
      trigger: "user-prompt",
      verifyBeforeFirstContinue: true,
    });
  }
  if (command.mode === "task-notification") {
    try {
      return await runActiveTargetContinuationLoop.call(this, {
        abortSignal,
        traceContext: command.traceContext,
        trigger: "task-notification",
        verifyBeforeFirstContinue: true,
      });
    } catch (error) {
      this.logger?.warn("Post-command goal continuation failed", {
        ...traceContextToLogContext(command.traceContext),
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "target.continuation.after_command_failed",
        module: "core.runtime",
      });
    }
  }
  return null;
}

export async function runTaskNotificationBatch(
  this: AgentRuntimeInternal,
  commands: readonly TaskNotificationRuntimeCommand[],
): Promise<void> {
  const eligibleCommands = commands.filter(
    (command) =>
      !isStaleBranchRuntimeCommand(this, command) &&
      !shouldSuppressTaskNotificationRuntimeCommand.call(this, command),
  );
  const firstCommand = eligibleCommands[0];
  if (!firstCommand) return;

  const foregroundExecution = beginForegroundExecution.call(this, firstCommand);
  const commandIds = eligibleCommands.map((command) => command.id);
  try {
    const persisted = await persistBackgroundTaskNotificationBatch.call(
      this,
      eligibleCommands as [TaskNotificationRuntimeCommand, ...TaskNotificationRuntimeCommand[]],
    );
    this.logger?.info?.("Background task notification batch started", {
      ...traceContextToLogContext(firstCommand.traceContext),
      batchSize: eligibleCommands.length,
      commandId: firstCommand.id,
      commandIds,
      event: "background_task.notification.batch_started",
      messageId: persisted.messageId,
      module: "core.runtime",
    });
    await this.executeTurnCommand(persisted.text, undefined, {
      // wake 缺 inputId，telemetry 借用了持久化 msg_*，与普通 main turn 分叉。
      // 每个独立 batch 使用同一 UUID v7 规则；持久化消息仍使用 recordedInputMessageId。
      inputId: uuidv7(),
      abortSignal: foregroundExecution.controller.signal,
      // 批次展示 metadata 只保留代表任务，composition 必须检查整批，不能被首个 Bash 任务遮蔽。
      backgroundSubagentResultConsumed: eligibleCommands.some(
        (command) => command.originMeta?.backgroundSource === "subagent",
      ),
      // 同一规则的 workflow 维度：run 的完成 / 提问通知在批里。
      workflowResultConsumed: eligibleCommands.some(
        (command) => command.originMeta?.backgroundSource === "workflow",
      ),
      ...(persisted.backgroundSource ? { backgroundSource: persisted.backgroundSource } : {}),
      inputSource: "background_task",
      inputVisibility: "model-only",
      ...(persisted.originMeta ? { originMeta: persisted.originMeta } : {}),
      recordedInputMessageId: persisted.messageId,
      skipInputRecord: true,
      skipUserPromptSubmitHooks: true,
      traceContext: firstCommand.traceContext,
    });
    await runPostCommandActiveTargetLoop.call(
      this,
      firstCommand,
      foregroundExecution.controller.signal,
    );
    this.logger?.info?.("Background task notification batch completed", {
      ...traceContextToLogContext(firstCommand.traceContext),
      batchSize: eligibleCommands.length,
      commandId: firstCommand.id,
      commandIds,
      event: "background_task.notification.batch_completed",
      messageId: persisted.messageId,
      module: "core.runtime",
    });
  } catch (error) {
    this.logger?.warn("Background task notification batch failed", {
      ...traceContextToLogContext(firstCommand.traceContext),
      batchSize: eligibleCommands.length,
      commandId: firstCommand.id,
      commandIds,
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "background_task.notification.batch_failed",
      module: "core.runtime",
    });
  } finally {
    finishForegroundExecution.call(this, foregroundExecution);
  }
}

export function beginForegroundExecution(
  this: AgentRuntimeInternal,
  command: RuntimeCommand,
): ActiveForegroundExecutionState {
  const controller = new AbortController();
  const parentAbortSignal = runtimeCommandAbortSignal(command);
  const abortFromParent = (): void => {
    controller.abort(parentAbortSignal?.reason);
  };
  if (parentAbortSignal?.aborted) {
    abortFromParent();
  } else {
    parentAbortSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const state: ActiveForegroundExecutionState = {
    controller,
    disposeParentAbort: () => {
      parentAbortSignal?.removeEventListener("abort", abortFromParent);
    },
    foregroundExecutionId: String(command.id),
    preserveQueueAutoDrainOnCancel: false,
  };
  // 旧 Stop 只持有 bootstrap 外层 controller，而 goal verifier/continuation
  // 已经越过普通 turn 生命周期。取消域必须覆盖整条 runtime command，才能在两个阶段
  // 的交界处仍命中同一次前台执行。
  this.activeForegroundExecution = state;
  return state;
}

export function finishForegroundExecution(
  this: AgentRuntimeInternal,
  state: ActiveForegroundExecutionState,
): void {
  state.disposeParentAbort();
  if (this.activeForegroundExecution === state) {
    this.activeForegroundExecution = undefined;
  }
}

export function runtimeCommandAbortSignal(command: RuntimeCommand): AbortSignal | undefined {
  if (
    command.mode === "prompt" ||
    command.mode === "target-continuation" ||
    command.mode === "target-continuation-loop"
  ) {
    return command.options?.abortSignal;
  }
  return undefined;
}
