import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Worker } from "node:worker_threads";
import type { RgArg, RipgrepBufferedResult } from "ripgrep";
import {
  createFileSystemError,
  type FileSystemSearchTextEntry,
  type FileSystemTextSearchOutputMode,
  type FileSystemSearchTextRequest,
} from "@mycode/contracts";
import {
  type RipgrepSearchPlan,
  addRipgrepContextArgs,
  addRipgrepGlobArgs,
} from "./fs-search-text-with-java-script.js";
import {
  VCS_DIRECTORIES_TO_EXCLUDE,
  ripgrepTimeoutMsForTests,
  DEFAULT_RIPGREP_TIMEOUT_MS,
  type RipgrepWorkerMessage,
  type RipgrepWorkerData,
  type RipgrepWorker,
  ripgrepWorkerFactoryForTests,
  RIPGREP_WORKER_SOURCE,
  type SerializedWorkerError,
} from "./fs-node-file-system-adapter-options.js";
import {
  TYPE_EXTENSION_MAP,
  createGlobMatcher,
  toPosixRelative,
  matchesFileType,
} from "./fs-atomic-write.js";

export interface ParsedTextSearch {
  entries: FileSystemSearchTextEntry[];
  files: string[];
  numMatches: number;
}

export class RipgrepRuntimeFailure extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Bundled ripgrep WASM failed to run");
    this.name = "RipgrepRuntimeFailure";
    this.cause = cause;
  }
}

export class RipgrepTimeoutFailure extends Error {
  constructor(timeoutMs: number) {
    super(
      `ripgrep search timed out after ${timeoutMs}ms. The search was terminated before it completed.`,
    );
    this.name = "RipgrepTimeoutFailure";
  }
}

export function createRipgrepSearchPlan(
  path: string,
  rootInfo: Awaited<ReturnType<typeof stat>>,
  request: FileSystemSearchTextRequest,
  mode: FileSystemTextSearchOutputMode,
): RipgrepSearchPlan {
  const outputRoot = rootInfo.isDirectory() ? path : dirname(path);
  const target = rootInfo.isDirectory() ? "." : basename(path);
  const args: RgArg[] = [
    "--no-config",
    "--hidden",
    "--color",
    "never",
    "--no-heading",
    "--with-filename",
    "--max-columns",
    "500",
  ];

  for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
    args.push("--glob", `!${dir}`, "--glob", `!**/${dir}/**`);
  }

  if (request.multiline) {
    args.push("-U", "--multiline-dotall");
  }

  if (request.ignoreCase) {
    args.push("-i");
  }

  if (mode === "content") {
    args.push("--json");
    if (request.onlyMatching) {
      args.push("--only-matching");
    }
    addRipgrepContextArgs(args, request);
  } else {
    args.push("-c");
  }

  if (request.glob) {
    addRipgrepGlobArgs(args, request.glob);
  }
  if (request.type) {
    addRipgrepTypeArgs(args, request.type);
  }

  args.push("-e", request.pattern.trim(), "--", target);

  return {
    args,
    outputRoot,
    preopens: { ".": outputRoot },
  };
}

export function addRipgrepTypeArgs(args: RgArg[], type: string): void {
  for (const pattern of fileTypeGlobPatterns(type)) {
    args.push("--glob", pattern);
  }
}

export function fileTypeGlobPatterns(type: string): string[] {
  const normalized = normalizeFileType(type);
  if (!/^[a-z0-9_+-]+$/i.test(normalized)) return [];
  const extensions = TYPE_EXTENSION_MAP[normalized] ?? [`.${normalized}`];
  return extensions.flatMap((extension) => [`*${extension}`, `**/*${extension}`]);
}

export function normalizeFileType(type: string): string {
  return type.toLowerCase().replace(/^\./, "");
}

export async function runBundledRipgrep(
  args: readonly RgArg[],
  preopens: Record<string, string>,
  options: { signal?: AbortSignal } = {},
): Promise<RipgrepBufferedResult> {
  try {
    return await runBundledRipgrepWorker(args, preopens, {
      signal: options.signal,
      timeoutMs: ripgrepTimeoutMsForTests ?? DEFAULT_RIPGREP_TIMEOUT_MS,
    });
  } catch (error) {
    if (isAbortError(error) || error instanceof RipgrepTimeoutFailure) {
      throw error;
    }
    throw new RipgrepRuntimeFailure(error);
  }
}

export function runBundledRipgrepWorker(
  args: readonly RgArg[],
  preopens: Record<string, string>,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<RipgrepBufferedResult> {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError("ripgrep search was cancelled before it started"));
  }

  // 不能在 agent 主线程里直接运行 WASI ripgrep。大目录搜索会占住 Node
  // event loop，导致 session/stop 虽然绕过协议队列，却没有机会被 agent 处理。
  // 放到 Worker 后，用户 stop 和超时都能从主线程 terminate 这个搜索执行单元。
  const worker = createRipgrepWorker({
    args: args.map(String),
    preopens,
  });

  return new Promise<RipgrepBufferedResult>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const terminateWorker = (): void => {
      const termination = worker.terminate();
      if (typeof termination === "object" && termination !== null && "catch" in termination) {
        void termination.catch(() => undefined);
      }
    };

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      options.signal?.removeEventListener("abort", handleAbort);
    };

    const settle = (settler: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      settler();
    };

    const handleAbort = (): void => {
      terminateWorker();
      settle(() => reject(createAbortError("ripgrep search was cancelled")));
    };

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutId = setTimeout(() => {
      terminateWorker();
      settle(() => reject(new RipgrepTimeoutFailure(options.timeoutMs)));
    }, options.timeoutMs);

    worker.once("message", (message: unknown) => {
      settle(() => {
        const parsed = message as Partial<RipgrepWorkerMessage>;
        if (parsed.type === "result" && parsed.result) {
          resolve(parsed.result);
          return;
        }
        if (parsed.type === "error") {
          reject(deserializeWorkerError(parsed.error));
          return;
        }
        reject(new Error("ripgrep worker returned an unknown message"));
      });
    });

    worker.once("error", (error: Error) => {
      settle(() => reject(error));
    });

    worker.once("exit", (code: number) => {
      if (settled) return;
      settle(() => reject(new Error(`ripgrep worker exited before returning a result: ${code}`)));
    });
  });
}

export function createRipgrepWorker(workerData: RipgrepWorkerData): RipgrepWorker {
  return (
    ripgrepWorkerFactoryForTests?.(workerData) ??
    new Worker(RIPGREP_WORKER_SOURCE, {
      eval: true,
      workerData,
    })
  );
}

export function deserializeWorkerError(serialized: SerializedWorkerError | undefined): Error {
  const error = new Error(serialized?.message ?? "ripgrep worker failed");
  error.name = serialized?.name ?? "Error";
  if (serialized?.stack) {
    error.stack = serialized.stack;
  }
  if (serialized && "code" in serialized) {
    Object.assign(error, { code: serialized.code });
  }
  return error;
}

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function splitOutputLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

export interface RipgrepJsonEvent {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    submatches?: Array<{ match?: { text?: string } }>;
    line_number?: number;
  };
}

export function createTextResultFilter(
  root: string,
  request: FileSystemSearchTextRequest,
): (path: string) => boolean {
  const globMatcher = request.glob ? createGlobMatcher(request.glob) : undefined;

  return (path) => {
    const relativePath = toPosixRelative(root, path);
    if (globMatcher && !globMatcher(relativePath, basename(path))) return false;
    if (request.type && !matchesFileType(path, request.type)) return false;
    return true;
  };
}

export function toRipgrepFileSystemError(stderr: string, path: string, pattern: string): Error {
  const message = stderr.trim() || `ripgrep failed while searching ${path}`;
  const normalized = message.toLowerCase();

  if (
    normalized.includes("regex parse error") ||
    normalized.includes("error parsing regex") ||
    normalized.includes("unclosed")
  ) {
    return createFileSystemError({
      code: "invalid_pattern",
      path,
      message: `Invalid grep regular expression: ${pattern}`,
    });
  }

  if (normalized.includes("permission denied") || normalized.includes("os error 13")) {
    return createFileSystemError({
      code: "permission_denied",
      path,
      message,
    });
  }

  if (normalized.includes("no such file") || normalized.includes("os error 2")) {
    return createFileSystemError({
      code: "not_found",
      path,
      message,
    });
  }

  return createFileSystemError({
    code: "io_error",
    path,
    message,
  });
}
