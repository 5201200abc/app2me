import { SessionEventType } from "../deps.js";
import type { BackgroundTaskInfoStatus, TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { stopDynamicWorkflowBackgroundTask } from "./background-stop-dynamic-workflow.js";
import type {
  RuntimeBackgroundStopOptions,
  RuntimeBackgroundStopResult,
  TypedRuntimeBackgroundStopTarget,
} from "./background-stop-types.js";
import { isTerminalRuntimeTask } from "../../runtime-task/registry.js";
import {
  resolveBackgroundStopTarget,
  isTypedBackgroundStopTarget,
  unsupportedBackgroundStopResult,
  isTerminalBackgroundStopTarget,
  commandFromRuntimeTask,
  stopLocalAgentBackgroundTask,
} from "./background-has-running-background-tasks.js";

// 停止分派的类型集中在 background-stop-types.ts（供各分支模块共用）；这里 re-export
// 保持既有 import 路径不变。
export type {
  RuntimeBackgroundStopOptions,
  RuntimeBackgroundStopResult,
} from "./background-stop-types.js";

export async function stopBackgroundTask(
  this: AgentRuntimeInternal,
  taskId: string,
  options: RuntimeBackgroundStopOptions,
): Promise<RuntimeBackgroundStopResult> {
  const traceContext = options.traceContext ?? this.rootTraceContext;
  const target = await resolveBackgroundStopTarget.call(this, taskId);
  if (!target) {
    return {
      ok: false,
      reason: "background_task_not_found",
      taskId,
    };
  }
  if (!isTypedBackgroundStopTarget(target)) {
    return unsupportedBackgroundStopResult(target);
  }

  if (isTerminalBackgroundStopTarget(target)) {
    if (options.strict) {
      return {
        ok: false,
        reason: "background_task_not_running",
        status: target.currentStatus,
        taskId,
        type: target.taskType,
      };
    }
    return {
      alreadyTerminal: true,
      command: commandFromRuntimeTask(target.registryTask, target.existing),
      ok: true,
      status: target.currentStatus ?? "lost",
      taskId,
      type: target.taskType,
    };
  }

  if (target.taskType === "local_agent") {
    return stopLocalAgentBackgroundTask.call(this, target);
  }

  if (target.taskType === "local_bash") {
    return stopLocalBashBackgroundTask.call(this, target, traceContext);
  }

  if (target.taskType === "local_dynamic_workflow") {
    return stopDynamicWorkflowBackgroundTask.call(
      this,
      target,
      unsupportedBackgroundStopResult,
      options.initiator,
    );
  }

  return unsupportedBackgroundStopResult(target);
}

async function stopLocalBashBackgroundTask(
  this: AgentRuntimeInternal,
  target: TypedRuntimeBackgroundStopTarget,
  traceContext: TraceContext,
): Promise<RuntimeBackgroundStopResult> {
  if (!this.executionPort?.cancelBackgroundTask) {
    return unsupportedBackgroundStopResult(target);
  }

  const cancelRequestedAt = new Date();
  if (target.existing?.status === "running") {
    await this.appendEvent(
      this.createEvent(
        SessionEventType.BackgroundTaskUpdated,
        this.buildBackgroundTaskPayload(target.taskId, target.existing, undefined, {
          cancelRequestedAt,
          cancellable: false,
          status: "running",
        }),
        traceContext,
      ),
      traceContext,
    );
  }

  const snapshot = await this.executionPort.cancelBackgroundTask(target.taskId);
  if (!snapshot) {
    const completedAt = new Date();
    if (target.registryTask) {
      this.runtimeTaskRegistry.update(target.taskId, (current) =>
        isTerminalRuntimeTask(current)
          ? current
          : {
              ...current,
              completedAt,
              isBackgrounded: true,
              status: "lost",
            },
      );
    }
    await this.appendEvent(
      this.createEvent(
        SessionEventType.BackgroundTaskCompleted,
        this.buildBackgroundTaskPayload(target.taskId, target.existing, undefined, {
          cancelRequestedAt,
          cancellable: false,
          completedAt,
          status: "lost",
        }),
        traceContext,
      ),
      traceContext,
    );
    return {
      ok: false,
      reason: "background_task_not_found",
      status: "lost",
      taskId: target.taskId,
      type: "local_bash",
    };
  }

  const status: BackgroundTaskInfoStatus =
    snapshot.status === "running" ? "cancelled" : snapshot.status;
  if (!target.registryTask) {
    await this.appendEvent(
      this.createEvent(
        SessionEventType.BackgroundTaskCompleted,
        this.buildBackgroundTaskPayload(target.taskId, target.existing, snapshot, {
          cancelRequestedAt,
          cancellable: false,
          completedAt: snapshot.completedAt ?? new Date(),
          status,
        }),
        traceContext,
      ),
      traceContext,
    );
  }
  return {
    command: commandFromRuntimeTask(target.registryTask, target.existing),
    ok: true,
    status,
    taskId: target.taskId,
    type: "local_bash",
  };
}

export { hasRunningBackgroundTasks } from "./background-has-running-background-tasks.js";
export { cancelBackgroundTask } from "./background-has-running-background-tasks.js";
export { cancelRunningRuntimeBackgroundTasks } from "./background-has-running-background-tasks.js";
export { buildBackgroundTaskPayload } from "./background-build-background-task-payload.js";
