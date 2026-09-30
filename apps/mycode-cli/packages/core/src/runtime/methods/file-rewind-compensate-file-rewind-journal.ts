import type { TraceContext } from "../deps.js";
import type {
  WorkspaceFileRewindIgnoredFile,
  WorkspaceFileRewindPreview,
  WorkspaceFileRewindUnsafeFile,
} from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  type FileRewindJournalEntry,
  type FileAggregate,
  type IgnoredFileAggregate,
  type WorkspaceFileRewindPlan,
} from "./file-rewind-planned-file-state.js";

export async function compensateFileRewindJournal(
  this: AgentRuntimeInternal,
  journal: FileRewindJournalEntry[],
  traceContext: TraceContext,
): Promise<void> {
  for (const entry of [...journal].reverse()) {
    if (!entry.state.exists || entry.state.content === null) {
      await this.fileSystemPort!.removeFile({
        path: entry.path,
        missingOk: true,
        trace: traceContext,
      });
      continue;
    }
    await this.fileSystemPort!.writeTextFile({
      path: entry.path,
      content: entry.state.content,
      createParents: true,
      atomic: true,
      trace: traceContext,
    });
  }
}

export function toUnsafeFile(file: FileAggregate): WorkspaceFileRewindUnsafeFile {
  return {
    operationCount: file.operationCount,
    path: file.path,
    reason: file.unsafe?.reason ?? "unsupported_checkpoint",
    toolNames: Array.from(file.toolNames).sort(),
    ...(file.unsafe?.message ? { message: file.unsafe.message } : {}),
    ...(file.unsafe?.expectedHash ? { expectedHash: file.unsafe.expectedHash } : {}),
    ...(file.unsafe?.currentHash ? { currentHash: file.unsafe.currentHash } : {}),
  };
}

export function toIgnoredFile(file: IgnoredFileAggregate): WorkspaceFileRewindIgnoredFile {
  return {
    operationCount: file.operationCount,
    path: file.path,
    reason: "bash_ignored",
    toolNames: Array.from(file.toolNames).sort(),
  };
}

export function compareByPath<T extends { path: string }>(left: T, right: T): number {
  return left.path.localeCompare(right.path);
}

export function toPreview(plan: WorkspaceFileRewindPlan): WorkspaceFileRewindPreview {
  return {
    canApply: plan.canApply,
    ignoredFiles: plan.ignoredFiles,
    safeFiles: plan.safeFiles,
    unsafeFiles: plan.unsafeFiles,
  };
}
