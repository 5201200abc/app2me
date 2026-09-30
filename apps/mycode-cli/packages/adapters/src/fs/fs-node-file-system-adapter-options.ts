import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { Worker } from "node:worker_threads";
import type { RipgrepBufferedResult } from "ripgrep";
import { createFileSystemError, type FileSystemNodeKind } from "@mycode/contracts";

export const DEFAULT_GLOB_MAX_RESULTS = 100;

export const DEFAULT_GREP_HEAD_LIMIT = 250;

export const DEFAULT_RIPGREP_TIMEOUT_MS = 30_000;

export const VCS_DIRECTORIES_TO_EXCLUDE = new Set([".git", ".svn", ".hg", ".bzr", ".jj", ".sl"]);

export type RipgrepWorker = Pick<Worker, "once" | "terminate">;

export interface RipgrepWorkerData {
  args: string[];
  preopens: Record<string, string>;
}

export interface SerializedWorkerError {
  code?: unknown;
  message?: string;
  name?: string;
  stack?: string;
}

export type RipgrepWorkerMessage =
  | { type: "result"; result: RipgrepBufferedResult }
  | { type: "error"; error: SerializedWorkerError };

export type RipgrepWorkerFactory = (workerData: RipgrepWorkerData) => RipgrepWorker;

export let ripgrepWorkerFactoryForTests: RipgrepWorkerFactory | undefined;

export let ripgrepTimeoutMsForTests: number | undefined;

export const RIPGREP_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error), name: "Error" };
  }
  return {
    code: "code" in error ? error.code : undefined,
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
}

(async () => {
  try {
    const { ripgrep } = await import("ripgrep");
    const result = await ripgrep(workerData.args, {
      buffer: true,
      env: {},
      nodeWasi: false,
      preopens: workerData.preopens,
      returnOnExit: true,
    });
    parentPort.postMessage({ type: "result", result });
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) });
  }
})();
`;

export interface NodeFileSystemAdapterOptions {
  textSearchEngine?: "ripgrep" | "javascript";
}

export function setRipgrepWorkerFactoryForTests(
  factory: RipgrepWorkerFactory | undefined,
): () => void {
  const previous = ripgrepWorkerFactoryForTests;
  ripgrepWorkerFactoryForTests = factory;
  return () => {
    ripgrepWorkerFactoryForTests = previous;
  };
}

export function setRipgrepTimeoutMsForTests(timeoutMs: number | undefined): () => void {
  const previous = ripgrepTimeoutMsForTests;
  ripgrepTimeoutMsForTests = timeoutMs;
  return () => {
    ripgrepTimeoutMsForTests = previous;
  };
}

export async function readFirstBytes(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readAtMostBytes(
  path: string,
  maxBytes: number,
  initialSizeBytes: number,
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    // 稳定文件按 stat 大小一次读取；只有文件在 stat 后增长时才继续分块追到硬上限。
    const firstBuffer = Buffer.allocUnsafe(Math.min(maxBytes, Math.max(1, initialSizeBytes + 1)));
    const chunks: Buffer[] = [];
    let bytesReadTotal = 0;
    while (bytesReadTotal < maxBytes) {
      const chunk =
        bytesReadTotal === 0
          ? firstBuffer
          : Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - bytesReadTotal));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, bytesReadTotal);
      // FileHandle.read 的短读不等于 EOF；只有明确返回 0 字节才能停止。
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
    }
    if (chunks.length === 0) return Buffer.alloc(0);
    return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, bytesReadTotal);
  } finally {
    await handle.close();
  }
}

export class SymlinkWriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymlinkWriteRefusedError";
  }
}

export function getNodeErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export function nodeKind(info: Awaited<ReturnType<typeof stat>>): FileSystemNodeKind {
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

export function revisionId(mtimeMs: number, sizeBytes: number): string {
  return `mtime:${Math.trunc(mtimeMs)}:size:${sizeBytes}`;
}

export function resolveAbsoluteRequestPath(path: string): string {
  if (!isAbsolute(path)) {
    throw createFileSystemError({
      code: "invalid_path",
      path,
      message: `FileSystemPort requires an absolute path: ${path}`,
    });
  }
  return normalize(path);
}

export function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${formatByteUnit(bytes / 1024)}KB`;
  return `${formatByteUnit(bytes / (1024 * 1024))}MB`;
}

export function formatByteUnit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function toFileSystemError(error: unknown, path: string): Error {
  if (error instanceof Error && error.name === "FileSystemPortError") {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    // Preserve cancellation as its own code so tools do not report user aborts as I/O failures.
    return createFileSystemError({
      code: "cancelled",
      path,
      message: `File system operation was cancelled: ${path}`,
      cause: error,
    });
  }

  const code = getNodeErrorCode(error);
  if (code === "ENOENT") {
    return createFileSystemError({
      code: "not_found",
      path,
      message: `File not found: ${path}`,
      cause: error,
    });
  }
  if (code === "EACCES" || code === "EPERM") {
    return createFileSystemError({
      code: "permission_denied",
      path,
      message: `Permission denied for path: ${path}`,
      cause: error,
    });
  }
  if (code === "EISDIR") {
    return createFileSystemError({
      code: "is_directory",
      path,
      message: `Path is a directory: ${path}`,
      cause: error,
    });
  }
  if (code === "ENAMETOOLONG") {
    return createFileSystemError({
      code: "invalid_path",
      path,
      message: `Invalid path: ${path}`,
      cause: error,
    });
  }

  return createFileSystemError({
    code: "io_error",
    path,
    message: error instanceof Error ? error.message : `File system error for path: ${path}`,
    cause: error,
  });
}
