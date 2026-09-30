import { type DynamicWorkflowRunStopReason, type ExecutionPort } from "@mycode/contracts";
import {
  type BashTaskNotificationStatus,
  type WorkflowTerminalRunStatus,
  type BackgroundTaskSnapshot,
  type BackgroundTaskWaiter,
  type WorkflowTaskWaiter,
} from "./background-tasks-background-task-snapshot.js";

export function buildBackgroundTaskSummary(input: {
  command?: string;
  description?: string;
  exitCode?: number;
  lost?: boolean;
  status: BashTaskNotificationStatus;
}): string {
  const subject = input.description ?? input.command ?? "Bash background command";
  const prefix = `Background command "${subject}"`;
  // Provider-visible summary 保持简洁；完整输出路径由 task-notification 的 output-file 字段承载。
  if (input.lost) return `${prefix} failed because its in-process state was lost`;
  switch (input.status) {
    case "completed":
      return `${prefix} completed${input.exitCode !== undefined ? ` (exit code ${input.exitCode})` : ""}`;
    case "failed":
      return `${prefix} failed${input.exitCode !== undefined ? ` with exit code ${input.exitCode}` : ""}`;
    case "killed":
      return `${prefix} was stopped`;
  }
}

export function buildWorkflowTaskSummary(input: {
  lost?: boolean;
  status: BashTaskNotificationStatus;
  runStatus?: WorkflowTerminalRunStatus;
  stopReason?: DynamicWorkflowRunStopReason | undefined;
  subject: string;
}): string {
  const prefix = `Workflow "${input.subject}"`;
  if (input.lost) return `${prefix} failed because its in-process state was lost.`;
  // 一句话就要把「怎么结束的」说清：模型读 summary 比读 XML 字段更早。dwf 的三终态词优先；
  // legacy `Workflow` 不带 runStatus，落回追踪器的通用词。
  if (input.runStatus === "errored") return `${prefix} errored: the script failed.`;
  if (input.runStatus === "stopped" || input.status === "killed") {
    switch (input.stopReason) {
      case "user":
        return `${prefix} was stopped by the user.`;
      case "model":
        return `${prefix} was stopped by you (TaskStop).`;
      case "provider":
        return `${prefix} was stopped on a provider error.`;
      case "interrupted":
        return `${prefix} was stopped: the process that owned it exited.`;
      case "superseded":
        return `${prefix} was stopped and superseded by an amended run.`;
      default:
        return `${prefix} was stopped.`;
    }
  }
  return input.status === "completed" ? `${prefix} completed.` : `${prefix} failed.`;
}

/**
 * 快照上的 dwf 渐进产物。`BackgroundTaskSnapshot` 是个联合类型（bash / subagent / legacy
 * workflow / dwf 各一支），只有 dwf 那支有 `reports`，所以按 `in` 收窄而不是断言。
 * 形状照样防御性检查：这条路径的输入来自端口实现，而快照是跨包契约。
 */
/**
 * 快照上的 dwf 脚本文件（绝对路径）。收窄方式与 {@link workflowSnapshotReports} 同款
 * （`in` 而不是断言：`BackgroundTaskSnapshot` 是四支联合，只有 dwf 那支有这个键），形状再过
 * 一遍 typeof——快照是跨包契约，老端口 / stub 完全可能不带它。
 */
export function workflowSnapshotScriptPath(
  snapshot: BackgroundTaskSnapshot | undefined,
): string | undefined {
  if (snapshot === undefined || !("scriptPath" in snapshot)) return undefined;
  return typeof snapshot.scriptPath === "string" && snapshot.scriptPath.length > 0
    ? snapshot.scriptPath
    : undefined;
}

export function getBackgroundTaskWaiter(
  executionPort: ExecutionPort | undefined,
): BackgroundTaskWaiter | undefined {
  const candidate = executionPort as Partial<BackgroundTaskWaiter> | undefined;
  return typeof candidate?.waitForBackgroundTask === "function"
    ? (candidate as BackgroundTaskWaiter)
    : undefined;
}

export function getWorkflowTaskWaiter(workflowPort: unknown): WorkflowTaskWaiter | undefined {
  const candidate = workflowPort as Partial<WorkflowTaskWaiter> | undefined;
  return typeof candidate?.waitForTask === "function"
    ? (candidate as WorkflowTaskWaiter)
    : undefined;
}
