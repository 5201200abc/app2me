// ============================================================
// Read Tool Handler
// ============================================================

import type { ToolHandler, ToolEntry } from "../types.js";
import {
  CoreErrorType,
  READ_MAX_FILE_SIZE_BYTES,
  ReadInputJsonSchema,
  ReadInputSchema,
  ReadOutputJsonSchema,
  ReadOutputSchema,
  createCoreError,
  isFileSystemPortError,
  type ReadOutput,
  type FileSystemStatResult,
} from "@mycode/contracts";
import { resolveWorkspacePath } from "../path-policy.js";
import { createReadFileStateKey } from "../read-file-state.js";
import { inferImageMimeFromPath, readImageFile } from "./read-image.js";
import { inferVideoMimeFromPath } from "../../runtime/helpers/attachment-video.js";
import { readVideoFile } from "./read-video.js";
import { readTextFileForModel } from "./read-text.js";
import {
  isPdfPath,
  READ_PDF_TOOL_TIMEOUT_MS,
  readPdfFile,
  resolveReadInputSchema,
  resolveReadProviderDescription,
  resolveReadTimeoutBudgetMs,
  supportsPdfForExecution,
} from "./read-pdf.js";
import {
  parseReadInput,
  createReadTrace,
  getReadFileState,
  normalizeCacheOffset,
  isCachedReadFresh,
  recordReadFileStateMetadata,
  updateReadFileState,
  READ_PROVIDER_DESCRIPTION,
  formatReadModelContent,
} from "./read-file-unchanged-stub.js";
import { createMissingReadFileMessage, validateReadInput } from "./read-validate-read-input.js";

export { addReadLineNumbers } from "./read-text.js";

const readHandler: ToolHandler = async (input, context) => {
  const { file_path, offset, limit, pages } = parseReadInput(input);
  const fileSystemPort = context.fileSystemPort;

  if (!fileSystemPort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "FileSystemPort is not configured for Read tool",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Read",
        },
        recoverable: false,
      },
    );
  }

  const filePath = resolveWorkspacePath({
    inputPath: file_path,
    operation: "read",
    workingDirectory: context.workingDirectory,
    workspaceRoot: context.workspaceRoot,
  });

  try {
    const imageMime = inferImageMimeFromPath(filePath);
    if (imageMime) {
      return await readImageFile(filePath, imageMime, context);
    }

    const videoMime = inferVideoMimeFromPath(filePath);
    if (videoMime) {
      return await readVideoFile(filePath, videoMime, context);
    }

    if (isPdfPath(filePath) && supportsPdfForExecution(context)) {
      return await readPdfFile({ filePath, pages }, context);
    }

    const trace = createReadTrace(context);
    const stat = await fileSystemPort.stat(
      { path: filePath, trace },
      { signal: context.abortSignal },
    );
    const readFileState = getReadFileState(context);
    const cacheOffset = normalizeCacheOffset(offset);
    const cacheKey = createReadFileStateKey(filePath, cacheOffset, limit);
    const cached = readFileState.get(cacheKey);
    if (cached && isCachedReadFresh(cached, stat)) {
      const output = { type: "file_unchanged", filePath } satisfies ReadOutput;
      recordReadFileStateMetadata(context, {
        output,
        readFileState,
        toolInput: input,
      });
      return output;
    }

    let rangeReadRevision: FileSystemStatResult["revision"] | undefined;
    const output = await readTextFileForModel({
      abortSignal: context.abortSignal,
      filePath,
      fileSystemPort,
      limit,
      onRead: (read) => {
        rangeReadRevision = read.revision;
      },
      offset,
      trace,
    });
    updateReadFileState(readFileState, cacheKey, {
      output,
      path: filePath,
      stat,
      rangeReadRevision,
      offset,
      limit,
    });
    recordReadFileStateMetadata(context, {
      output,
      readFileState,
      toolInput: input,
    });
    return output;
  } catch (error) {
    if (isFileSystemPortError(error) && error.code === "not_found") {
      const message = await createMissingReadFileMessage(filePath, context);
      throw createCoreError(CoreErrorType.ToolExecutionFailed, message, {
        cause: error,
        context: {
          code: "read_file_not_found",
          filePath,
        },
        recoverable: true,
      });
    }
    if (isFileSystemPortError(error) && error.code === "too_large") {
      throw createCoreError(CoreErrorType.ToolExecutionFailed, error.message, {
        cause: error,
        context: {
          code: "read_file_too_large",
          filePath,
          maxBytes: READ_MAX_FILE_SIZE_BYTES,
        },
        recoverable: true,
      });
    }
    throw error;
  }
};

export const readToolEntry: ToolEntry = {
  capability:
    "Read text files and supported images from the file-system adapter without modifying files",
  metadata: {
    name: "Read",
    description: READ_PROVIDER_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: 30000,
    maxOutputBytes: READ_MAX_FILE_SIZE_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: readHandler,
  validateInput: validateReadInput,
  resolveModelContract: (context) => ({
    description: resolveReadProviderDescription(READ_PROVIDER_DESCRIPTION, context),
    inputSchema: resolveReadInputSchema(context),
  }),
  resolveTimeoutBudgetMs: resolveReadTimeoutBudgetMs,
  formatModelContent: formatReadModelContent,
  inputSchema: ReadInputJsonSchema,
  outputSchema: ReadOutputJsonSchema,
  runtimeInputSchema: ReadInputSchema,
  runtimeOutputSchema: ReadOutputSchema,
  permission: {
    permission: "read",
    reason: "Read only inspects file content and has no external side effects",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["path"],
    alwaysAllowPatternSources: ["path"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: READ_MAX_FILE_SIZE_BYTES,
    maxModelBytes: READ_MAX_FILE_SIZE_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: READ_MAX_FILE_SIZE_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: 30000,
    maxMs: READ_PDF_TOOL_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "required",
    userVisibleMessage: "Read was cancelled before file content was returned",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
