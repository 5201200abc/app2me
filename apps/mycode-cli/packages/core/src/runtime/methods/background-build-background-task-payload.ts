import type {
  BackgroundExecutionSnapshot,
  BackgroundTaskInfo,
  BackgroundTaskInfoStatus,
} from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

export function buildBackgroundTaskPayload(
  this: AgentRuntimeInternal,
  taskId: string,
  existing: BackgroundTaskInfo | undefined,
  snapshot: BackgroundExecutionSnapshot | undefined,
  overrides: {
    cancelRequestedAt?: Date;
    cancellable?: boolean;
    completedAt?: Date;
    status?: BackgroundTaskInfoStatus;
  } = {},
): BackgroundTaskInfo {
  const result = snapshot?.result;
  const stdoutBytes = result?.stdout.bytes ?? snapshot?.stdoutBytes ?? existing?.stdoutBytes;
  const stderrBytes = result?.stderr.bytes ?? snapshot?.stderrBytes ?? existing?.stderrBytes;
  const stdoutTail = result?.stdout.text || snapshot?.stdoutTail || existing?.stdoutTail;
  const stderrTail = result?.stderr.text || snapshot?.stderrTail || existing?.stderrTail;
  const stdoutPersistedOutputPath =
    snapshot?.stdoutPersistedOutputPath ??
    result?.stdout.artifactPath ??
    existing?.stdoutPersistedOutputPath;
  const stderrPersistedOutputPath =
    snapshot?.stderrPersistedOutputPath ??
    result?.stderr.artifactPath ??
    existing?.stderrPersistedOutputPath;
  const outputBytes =
    stdoutBytes === undefined && stderrBytes === undefined
      ? existing?.outputBytes
      : (stdoutBytes ?? 0) + (stderrBytes ?? 0);
  const outputPath =
    snapshot?.outputPath ??
    stdoutPersistedOutputPath ??
    stderrPersistedOutputPath ??
    existing?.outputPath;
  const outputTruncated =
    result === undefined
      ? existing?.outputTruncated
      : result.stdout.truncated ||
        result.stderr.truncated ||
        result.stdout.artifactTruncated ||
        result.stderr.artifactTruncated;
  const status =
    overrides.status ??
    ((snapshot?.status ?? existing?.status ?? "lost") as BackgroundTaskInfoStatus);

  return {
    taskId,
    toolCallId: existing?.toolCallId,
    toolName: existing?.toolName,
    // 此构造器只服务 local Bash stop/update；Agent 终态由 subagent runner 产生。
    taskKind: "bash",
    blocked: existing?.blocked,
    blockedReason: existing?.blockedReason,
    cancellable: overrides.cancellable ?? (status === "running" && Boolean(snapshot)),
    cancelRequestedAt: overrides.cancelRequestedAt ?? existing?.cancelRequestedAt,
    command: existing?.command,
    description: existing?.description,
    status,
    pid: snapshot?.pid ?? result?.pid ?? existing?.pid,
    startedAt: snapshot?.startedAt ?? result?.startedAt ?? existing?.startedAt,
    completedAt: overrides.completedAt ?? snapshot?.completedAt ?? existing?.completedAt,
    outputPath,
    stderrPersistedOutputPath,
    stdoutPersistedOutputPath,
    outputBytes,
    outputTruncated,
    outputTail: stdoutTail ?? stderrTail ?? existing?.outputTail,
    stderrBytes,
    stderrTail,
    stdoutBytes,
    stdoutTail,
    terminalId: existing?.terminalId ?? taskId,
  };
}
