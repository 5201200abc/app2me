import { traceContextToLogContext } from "../deps.js";
import type {
  BackgroundTaskCancelResult,
  BackgroundTaskInfo,
  BackgroundTaskInfoStatus,
  TraceContext,
} from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type {
  RuntimeBackgroundStopResult,
  RuntimeBackgroundStopStatus,
  RuntimeBackgroundStopTarget,
  TypedRuntimeBackgroundStopTarget,
} from "./background-stop-types.js";
import type { RuntimeTaskSnapshot, RuntimeTaskType } from "../../runtime-task/registry.js";
import {
  hasRunningBackgroundRuntimeTask,
  isTerminalRuntimeTask,
} from "../../runtime-task/registry.js";

/**
 * Session 常驻池的同步权威查询。
 *
 * 协议层的 activeAbortController 只覆盖前台 turn，后台 Bash/Agent/Workflow
 * 已经从前台 turn 脱离但仍需要当前 runtime 接收终态与唤醒通知。回收判定必须直接读取
 * runtime task registry，不能从协议投影或 UI 状态猜测。
 */
export function hasRunningBackgroundTasks(this: AgentRuntimeInternal): boolean {
  return hasRunningBackgroundRuntimeTask(this.runtimeTaskRegistry);
}

export async function cancelBackgroundTask(
  this: AgentRuntimeInternal,
  taskId: string,
  options: { traceContext?: TraceContext } = {},
): Promise<BackgroundTaskCancelResult> {
  // cancelBackgroundTask 只有 GUI 与后台面板会调（v4 cancelBackgroundWork）：这就是用户的手。
  const result = await this.stopBackgroundTask(taskId, {
    initiator: "user",
    traceContext: options.traceContext,
  });
  if (!result.ok) {
    return {
      cancelled: false,
      reason: result.reason,
      status: toBackgroundTaskInfoStatus(result.status) ?? "lost",
      taskId,
    };
  }
  const projection = await this.rebuildProjection();
  const status = toBackgroundTaskInfoStatus(result.status) ?? "lost";
  return {
    cancelled: status === "cancelled",
    reason: result.alreadyTerminal ? "background_task_not_running" : undefined,
    snapshot: projection.backgroundTasks.find((task) => task.taskId === taskId),
    status,
    taskId,
  };
}

export async function resolveBackgroundStopTarget(
  this: AgentRuntimeInternal,
  taskId: string,
): Promise<RuntimeBackgroundStopTarget | undefined> {
  const registryTask = this.runtimeTaskRegistry.get(taskId);
  const projection = await this.rebuildProjection();
  const existing =
    projection.backgroundTasks.find((task) => task.taskId === taskId) ??
    (registryTask ? backgroundInfoFromRuntimeTask(registryTask) : undefined);
  if (!registryTask && !existing) {
    return undefined;
  }

  const taskType = registryTask?.type ?? runtimeTaskTypeFromBackgroundInfo(existing);
  return {
    currentStatus: registryTask?.status ?? existing?.status,
    existing,
    registryTask,
    taskId,
    taskType,
  };
}

export function isTerminalBackgroundStopTarget(target: RuntimeBackgroundStopTarget): boolean {
  return (
    (target.registryTask ? isTerminalRuntimeTask(target.registryTask) : false) ||
    isTerminalBackgroundTaskInfoStatus(target.existing?.status)
  );
}

export function isTypedBackgroundStopTarget(
  target: RuntimeBackgroundStopTarget,
): target is TypedRuntimeBackgroundStopTarget {
  return target.taskType !== undefined;
}

export function unsupportedBackgroundStopResult(
  target: RuntimeBackgroundStopTarget,
): RuntimeBackgroundStopResult {
  return {
    ok: false,
    reason: "background_task_cancel_not_supported",
    status: target.currentStatus,
    taskId: target.taskId,
    ...(target.taskType ? { type: target.taskType } : {}),
  };
}

export async function stopLocalAgentBackgroundTask(
  this: AgentRuntimeInternal,
  target: TypedRuntimeBackgroundStopTarget,
): Promise<RuntimeBackgroundStopResult> {
  if (!this.subagentPort?.stopTask) {
    return unsupportedBackgroundStopResult(target);
  }
  const snapshot = await this.subagentPort.stopTask(target.taskId);
  if (!snapshot) {
    return {
      ok: false,
      reason: "background_task_not_found",
      status: "lost",
      taskId: target.taskId,
      ...(target.taskType ? { type: target.taskType } : {}),
    };
  }
  return {
    command: commandFromRuntimeTask(target.registryTask, target.existing),
    ok: true,
    status: snapshot.status,
    taskId: target.taskId,
    type: "local_agent",
  };
}

export async function cancelRunningRuntimeBackgroundTasks(
  this: AgentRuntimeInternal,
  input: { reason: "subagent_cancelled"; traceContext?: TraceContext },
): Promise<void> {
  if (this.config.taskType !== "subagent_child") return;
  const traceContext = input.traceContext ?? this.rootTraceContext;
  const tasks = Object.values(this.runtimeTaskRegistry.all()).filter(
    (task) =>
      task.type === "local_bash" && task.isBackgrounded === true && task.status === "running",
  );

  for (const task of tasks) {
    this.logger?.info?.("Cancelling subagent background task during runtime cleanup", {
      ...traceContextToLogContext(traceContext),
      event: "runtime.background_task.cleanup_cancel",
      module: "core.runtime",
      reason: input.reason,
      taskId: task.taskId,
    });
    await this.stopBackgroundTask(task.taskId, {
      traceContext,
    });
  }
}

export function backgroundInfoFromRuntimeTask(task: RuntimeTaskSnapshot): BackgroundTaskInfo {
  return {
    taskId: task.taskId,
    toolCallId: typeof task.parentToolCallId === "string" ? task.parentToolCallId : undefined,
    toolName: toolNameFromRuntimeTaskType(task.type),
    cancellable: task.status === "running",
    command: commandFromRuntimeTask(task, undefined),
    description: task.description,
    status: toBackgroundTaskInfoStatus(task.status) ?? "lost",
    pid: task.pid,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    outputPath: task.outputFile,
    terminalId: task.taskId,
  };
}

export function commandFromRuntimeTask(
  task: RuntimeTaskSnapshot | undefined,
  existing: BackgroundTaskInfo | undefined,
): string | undefined {
  // TaskStop 对 local_agent 返回短 description；旧 projection 的 command
  // 可能已保存为完整 prompt，因此运行时任务必须先于 existing.command 取值。
  if (task?.type === "local_agent") return task.description;
  if (!task && existing?.toolName === "Agent") return existing.description;
  if (existing?.command) return existing.command;
  if (task?.type === "local_bash") return task.description || task.prompt;
  return task?.prompt;
}

export function runtimeTaskTypeFromBackgroundInfo(
  task: BackgroundTaskInfo | undefined,
): RuntimeTaskType | undefined {
  switch (task?.toolName) {
    case "Bash":
      return "local_bash";
    case "Agent":
      return "local_agent";
    case "Workflow":
      return "local_workflow";
    case "CreateWorkflow":
    case "AmendWorkflow":
      return "local_dynamic_workflow";
    default:
      return undefined;
  }
}

export function toolNameFromRuntimeTaskType(type: RuntimeTaskType): string {
  switch (type) {
    case "local_agent":
      return "Agent";
    case "local_bash":
      return "Bash";
    case "local_workflow":
      return "Workflow";
    case "local_dynamic_workflow":
      return "CreateWorkflow";
    case "monitor_mcp":
      return "Monitor";
  }
}

export function isTerminalBackgroundTaskInfoStatus(
  status: BackgroundTaskInfoStatus | undefined,
): boolean {
  return Boolean(status && status !== "running");
}

export function toBackgroundTaskInfoStatus(
  status: RuntimeBackgroundStopStatus | undefined,
): BackgroundTaskInfoStatus | undefined {
  switch (status) {
    case "cancelled":
    case "killed":
    case "stopped":
      return "cancelled";
    case "completed":
    case "failed":
    case "lost":
    case "running":
    case "spawn_error":
    case "timed_out":
      return status;
    default:
      return undefined;
  }
}
