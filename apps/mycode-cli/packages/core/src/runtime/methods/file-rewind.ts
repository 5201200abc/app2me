import {
  RewindScope,
  RewindStrategy,
  SessionEventType,
  getCurrentTraceContext,
  parseWorkspaceCheckpointArtifact,
  traceContextToLogContext,
} from "../deps.js";
import type {
  CheckpointCreatedPayload,
  MessageId,
  TraceContext,
  TurnId,
  WorkspaceCheckpointArtifact,
} from "../deps.js";
import { throwIfTurnAborted } from "../helpers/index.js";
import type {
  WorkspaceFileRewindApplyResult,
  WorkspaceFileRewindPreview,
  WorkspaceFileRewindUnsafeFile,
} from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  toPreview,
  compensateFileRewindJournal,
  compareByPath,
  toUnsafeFile,
  toIgnoredFile,
} from "./file-rewind-compensate-file-rewind-journal.js";
import {
  type FileRewindJournalEntry,
  readCurrentFileState,
  type WorkspaceFileRewindPlan,
  resolveTargetCheckpoints,
  type IgnoredFileAggregate,
  type FileCheckpointOperation,
  type FileAggregate,
  isIgnoredShellTool,
  addIgnoredFile,
  resolveCheckpointFilePath,
  resolveCheckpointAfterContent,
  markUnsafe,
  type PlannedFileState,
  ensureFileAggregate,
  hashContent,
  toSafeFile,
} from "./file-rewind-planned-file-state.js";

export async function previewWorkspaceFileRewind(
  this: AgentRuntimeInternal,
  options: {
    abortSignal?: AbortSignal;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    targetMessageIds?: MessageId[];
    targetTurnId?: TurnId;
    traceContext?: TraceContext;
  } = {},
): Promise<WorkspaceFileRewindPreview> {
  const plan = await buildWorkspaceFileRewindPlan.call(this, options);
  return toPreview(plan);
}

export async function applyWorkspaceFileRewind(
  this: AgentRuntimeInternal,
  options: {
    abortSignal?: AbortSignal;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    targetMessageIds?: MessageId[];
    targetTurnId?: TurnId;
    traceContext?: TraceContext;
    /** 组合 rewind 的提交闸：文件全部写成功后、workspace event 发布前提交 branch cut。 */
    commitAfterApply?: () => Promise<void>;
  } = {},
): Promise<WorkspaceFileRewindApplyResult> {
  const traceContext = options.traceContext ?? getCurrentTraceContext() ?? this.rootTraceContext;
  const plan = await buildWorkspaceFileRewindPlan.call(this, {
    ...options,
    traceContext,
  });
  if (!plan.canApply) {
    return {
      applied: false,
      preview: toPreview(plan),
      response: "File rewind was not applied because at least one file is unsafe.",
    };
  }

  if (!this.fileSystemPort) {
    return {
      applied: false,
      preview: toPreview({
        ...plan,
        canApply: false,
        unsafeFiles: [
          ...plan.unsafeFiles,
          {
            operationCount: 1,
            path: "workspace",
            reason: "file_read_failed",
            toolNames: [],
            message: "FileSystemPort is not configured.",
          },
        ],
      }),
      response: "File rewind was not applied because the file-system adapter is unavailable.",
    };
  }

  const restoredFiles: Array<{ action: "delete" | "restore"; path: string }> = [];
  const journal: FileRewindJournalEntry[] = [];
  try {
    for (const operation of plan.operations) {
      throwIfTurnAborted(options.abortSignal);
      const state = await readCurrentFileState.call(
        this,
        operation.path,
        traceContext,
        options.abortSignal,
      );
      if ("reason" in state) {
        throw new Error(state.message ?? `Failed to journal ${operation.path}`);
      }
      journal.push({ path: operation.path, state });
      if (operation.action === "delete" || operation.beforeContent === null) {
        await this.fileSystemPort.removeFile(
          {
            path: operation.path,
            missingOk: true,
            trace: traceContext,
          },
          { signal: options.abortSignal },
        );
        restoredFiles.push({ action: "delete", path: operation.path });
        continue;
      }

      await this.fileSystemPort.writeTextFile(
        {
          path: operation.path,
          content: operation.beforeContent,
          createParents: true,
          atomic: true,
          trace: traceContext,
        },
        { signal: options.abortSignal },
      );
      restoredFiles.push({ action: "restore", path: operation.path });
    }
    await options.commitAfterApply?.();
  } catch (error) {
    // 多文件 rewind 过去在第 N 次写失败时会留下半回滚 workspace。
    // journal 按写入逆序恢复命令执行前内容；补偿失败升级为不可恢复错误。
    try {
      await compensateFileRewindJournal.call(this, journal, traceContext);
    } catch (compensationError) {
      throw new AggregateError(
        [error, compensationError],
        "Workspace file rewind failed and compensation was incomplete",
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      applied: false,
      preview: {
        ...toPreview(plan),
        canApply: false,
        unsafeFiles: [
          ...plan.unsafeFiles,
          {
            operationCount: Math.max(1, journal.length),
            path: journal.at(-1)?.path ?? "workspace",
            reason: "file_read_failed",
            toolNames: [],
            message,
          },
        ],
      },
      response: "File rewind was not applied because the write failed; prior files were restored.",
    };
  }

  const firstOperation = plan.operations[0];
  const lastOperation = plan.operations.at(-1);
  const targetMessageId = options.targetMessageId ?? options.targetMessageIds?.[0];
  const rewindId = `rewind_${crypto.randomUUID()}`;
  const event = this.createEvent(
    SessionEventType.RewindTriggered,
    {
      rewindId,
      scope: RewindScope.Workspace,
      strategy: RewindStrategy.ActiveChain,
      targetMessageId,
      targetCheckpointId: lastOperation?.checkpoint.checkpointId,
      restoredSnapshotRef: lastOperation?.checkpoint.snapshotRef,
      reason: "file_summary_rewind",
    },
    traceContext,
  );
  await this.appendEvent(event, traceContext);

  this.logger?.info("Workspace file summary rewind applied", {
    ...traceContextToLogContext(traceContext),
    event: "rewind.file_summary.completed",
    fileCount: plan.safeFiles.length,
    module: "core.runtime",
    operationCount: plan.operations.length,
    restoredFileCount: restoredFiles.length,
    status: "completed",
    targetCheckpointId: lastOperation?.checkpoint.checkpointId,
    targetMessageId,
  });

  return {
    applied: true,
    preview: toPreview(plan),
    response: `Rewound ${plan.safeFiles.length} file${plan.safeFiles.length === 1 ? "" : "s"} from summary checkpoints.`,
  };
}

async function buildWorkspaceFileRewindPlan(
  this: AgentRuntimeInternal,
  options: {
    abortSignal?: AbortSignal;
    targetCheckpointId?: string;
    targetMessageId?: MessageId;
    targetMessageIds?: MessageId[];
    targetTurnId?: TurnId;
    traceContext?: TraceContext;
  },
): Promise<WorkspaceFileRewindPlan> {
  const traceContext = options.traceContext ?? getCurrentTraceContext() ?? this.rootTraceContext;
  if (!this.artifactStore || !this.fileSystemPort) {
    return {
      canApply: false,
      ignoredFiles: [],
      operations: [],
      safeFiles: [],
      unsafeFiles: [
        {
          operationCount: 1,
          path: "workspace",
          reason: !this.artifactStore ? "checkpoint_unreadable" : "file_read_failed",
          toolNames: [],
          message: !this.artifactStore
            ? "ArtifactStore is not configured."
            : "FileSystemPort is not configured.",
        },
      ],
    };
  }

  const events = await this.eventStore.getEvents(this.sessionId);
  const checkpoints = resolveTargetCheckpoints(events, {
    targetCheckpointId: options.targetCheckpointId,
    targetMessageId: options.targetMessageId,
    targetMessageIds: options.targetMessageIds,
  });
  if (checkpoints.length === 0) {
    return {
      canApply: false,
      ignoredFiles: [],
      operations: [],
      safeFiles: [],
      unsafeFiles: [],
    };
  }

  const artifacts: Array<{
    artifact: WorkspaceCheckpointArtifact;
    checkpoint: CheckpointCreatedPayload;
  }> = [];
  const unreadableFiles: WorkspaceFileRewindUnsafeFile[] = [];

  for (const checkpoint of checkpoints) {
    throwIfTurnAborted(options.abortSignal);
    try {
      const read = await this.artifactStore.readToolResultArtifact(
        {
          uri: checkpoint.snapshotRef,
          trace: traceContext,
        },
        { signal: options.abortSignal },
      );
      artifacts.push({
        artifact: parseWorkspaceCheckpointArtifact(JSON.parse(read.content)),
        checkpoint,
      });
    } catch (error) {
      unreadableFiles.push({
        operationCount: Math.max(1, checkpoint.fileCount ?? 1),
        path: `checkpoint:${checkpoint.checkpointId}`,
        reason: "checkpoint_unreadable",
        toolNames: [],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ignoredByPath = new Map<string, IgnoredFileAggregate>();
  const operations: FileCheckpointOperation[] = [];
  const unsupportedByPath = new Map<string, FileAggregate>();

  for (const { artifact, checkpoint } of artifacts) {
    if (isIgnoredShellTool(artifact.toolName)) {
      for (const file of artifact.files) {
        addIgnoredFile(
          ignoredByPath,
          resolveCheckpointFilePath(this.workspaceRoot, file.path),
          artifact.toolName,
        );
      }
      continue;
    }

    for (const file of artifact.files) {
      // Write/ApplyPatch checkpoint 会保留模型传入的工作区相对路径，而
      // FileSystemPort 只接受绝对路径。若不在计划阶段按 runtime workspace root
      // 解析，安全文件会被误报 file_read_failed，组合 rewind 只返回 blocked。
      const filePath = resolveCheckpointFilePath(this.workspaceRoot, file.path);
      const afterContent = resolveCheckpointAfterContent(file);
      if (afterContent === undefined) {
        markUnsafe(unsupportedByPath, {
          action: file.existedBefore && file.beforeContent !== null ? "restore" : "delete",
          path: filePath,
          reason: "unsupported_checkpoint",
          toolName: artifact.toolName,
        });
        continue;
      }

      operations.push({
        action: file.existedBefore && file.beforeContent !== null ? "restore" : "delete",
        afterContent,
        artifact,
        beforeContent: file.beforeContent,
        checkpoint,
        path: filePath,
        toolName: artifact.toolName,
      });
    }
  }

  const simulatedByPath = new Map<string, PlannedFileState>();
  const safeByPath = new Map<string, FileAggregate>();
  const unsafeByPath = new Map<string, FileAggregate>(unsupportedByPath);
  const applyOperations: FileCheckpointOperation[] = [];

  for (const operation of [...operations].reverse()) {
    throwIfTurnAborted(options.abortSignal);
    const aggregate = ensureFileAggregate(safeByPath, operation);
    aggregate.operationCount += 1;
    aggregate.toolNames.add(operation.toolName);
    aggregate.action = operation.action;

    if (unsafeByPath.has(operation.path)) {
      continue;
    }

    const currentState =
      simulatedByPath.get(operation.path) ??
      (await readCurrentFileState.call(this, operation.path, traceContext, options.abortSignal));
    if ("reason" in currentState) {
      markUnsafe(unsafeByPath, {
        action: operation.action,
        message: currentState.message,
        path: operation.path,
        reason: currentState.reason,
        toolName: operation.toolName,
      });
      continue;
    }

    const expectedHash = hashContent(operation.afterContent);
    if (currentState.hash !== expectedHash) {
      markUnsafe(unsafeByPath, {
        action: operation.action,
        currentHash: currentState.hash ?? "missing",
        expectedHash,
        path: operation.path,
        reason: "external_modified",
        toolName: operation.toolName,
      });
      continue;
    }

    simulatedByPath.set(operation.path, {
      content: operation.beforeContent,
      exists: operation.beforeContent !== null,
      hash: hashContent(operation.beforeContent),
    });
    applyOperations.push(operation);
  }

  for (const [path, unsafe] of unsafeByPath) {
    safeByPath.delete(path);
    unsafe.operationCount = Math.max(
      unsafe.operationCount,
      operations.filter((operation) => operation.path === path).length,
    );
  }

  const safeFiles = Array.from(safeByPath.values()).map(toSafeFile).sort(compareByPath);
  const unsafeFiles = [
    ...unreadableFiles,
    ...Array.from(unsafeByPath.values()).map(toUnsafeFile),
  ].sort(compareByPath);
  const ignoredFiles = Array.from(ignoredByPath.values()).map(toIgnoredFile).sort(compareByPath);

  return {
    canApply: safeFiles.length > 0 && unsafeFiles.length === 0,
    ignoredFiles,
    operations: unsafeFiles.length === 0 ? applyOperations : [],
    safeFiles,
    unsafeFiles,
  };
}
