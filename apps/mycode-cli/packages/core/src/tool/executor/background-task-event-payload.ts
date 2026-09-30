import type { ExecutableToolCall } from "../types.js";

import { isRecord } from "./utils.js";

import { isDynamicWorkflowRunDispatchToolName } from "./background-task-registry.js";
import { backgroundTaskOutputMetadata } from "./background-task-output.js";

import {
  type BackgroundTaskSnapshot,
  backgroundTaskKind,
  workflowTaskSubject,
} from "./background-tasks-background-task-snapshot.js";

export function buildBackgroundTaskEventPayload(
  canCancelBackgroundTask: (toolCall: ExecutableToolCall) => boolean,
  toolCall: ExecutableToolCall,
  taskId: string,
  status: string,
  snapshot?: BackgroundTaskSnapshot,
  output?: Record<string, unknown>,
): Record<string, unknown> {
  const input = isRecord(toolCall.input) ? toolCall.input : {};
  const outputMetadata = backgroundTaskOutputMetadata(snapshot, output);

  return {
    taskId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    // V4 projection 过去从 toolName 手写推断类型，漏掉真实 Agent
    // 工具名后把后台 subagent 投成 bash/process。runtime 在事实产生处一次裁决。
    // 生命周期行为不受影响——那已经由 per-tool 的 lifecycleProvider 分派。
    taskKind: backgroundTaskKind(toolCall.name),
    childSessionId: outputMetadata.childSessionId,
    cancellable: status === "running" && canCancelBackgroundTask(toolCall),
    command: typeof input.command === "string" ? input.command : undefined,
    // CreateWorkflow 的输入 schema 里没有 `description`（只有 `{name?, script}`，
    // contracts/src/tools/create-workflow.ts），走通用的 input.description → snapshot.description
    // 链会整字段缺席，Workflows 分区的题名于是退到 toolName，每个 run 都显示成
    // "CreateWorkflow"。展示名与完成通知共用同一条兜底链（含 input.name），所以直接复用
    // workflowTaskSubject。它最后一环是 taskId（≡ runId）：投影会把它原样当题名，与缺席时
    // 退 toolName 并不相同——UI 侧约定 title ≡ workId 视同「无名」并换用 fallbackName，
    // 所以这一环到不了用户眼前，同时保住了「description 恒非空」的简单性。
    // dwf 分派名扩到 ResumeWorkflowRun：同一条兜底链（它也只有 run_id，无 description）。
    description: isDynamicWorkflowRunDispatchToolName(toolCall.name)
      ? workflowTaskSubject(toolCall, taskId, snapshot, output)
      : typeof input.description === "string"
        ? input.description
        : snapshot && "description" in snapshot
          ? snapshot.description
          : undefined,
    status,
    pid: snapshot && "pid" in snapshot ? snapshot.pid : undefined,
    startedAt: snapshot?.startedAt,
    completedAt: snapshot?.completedAt,
    outputPath: outputMetadata.outputFile,
    stderrPersistedOutputPath: outputMetadata.stderrFile,
    stdoutPersistedOutputPath: outputMetadata.stdoutFile,
    outputBytes: outputMetadata.outputBytes,
    outputTruncated: outputMetadata.outputTruncated,
    outputTail: outputMetadata.outputTail,
    stderrBytes: outputMetadata.stderrBytes,
    stderrTail: outputMetadata.stderrTail,
    stdoutBytes: outputMetadata.stdoutBytes,
    stdoutTail: outputMetadata.stdoutTail,
    terminalId: taskId,
  };
}
