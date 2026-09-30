import { stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import {
  createFileSystemError,
  type FileSystemSearchTextEntry,
  type FileSystemSearchTextRequest,
  type FileSystemSearchTextResult,
} from "@mycode/contracts";
import {
  resolveAbsoluteRequestPath,
  toFileSystemError,
} from "./fs-node-file-system-adapter-options.js";
import { throwIfAborted } from "./fs-atomic-write.js";
import {
  createRipgrepSearchPlan,
  runBundledRipgrep,
  toRipgrepFileSystemError,
  type ParsedTextSearch,
  createTextResultFilter,
  splitOutputLines,
  type RipgrepJsonEvent,
} from "./fs-parsed-text-search.js";
import { finishTextSearchResult } from "./fs-search-text-with-java-script.js";
import { createOnlyMatchingEntries } from "./fs-text-search-result.js";

export async function searchTextWithRipgrep(
  request: FileSystemSearchTextRequest,
  signal?: AbortSignal,
): Promise<FileSystemSearchTextResult> {
  const path = resolveAbsoluteRequestPath(request.path);
  const pattern = request.pattern.trim();
  const startedAt = Date.now();

  if (pattern.length === 0) {
    throw createFileSystemError({
      code: "invalid_pattern",
      path,
      message: "Grep pattern must not be empty",
    });
  }

  let rootInfo: Awaited<ReturnType<typeof stat>>;
  try {
    throwIfAborted(signal);
    rootInfo = await stat(path);
  } catch (error) {
    throw toFileSystemError(error, path);
  }

  if (!rootInfo.isFile() && !rootInfo.isDirectory()) {
    throw createFileSystemError({
      code: "not_file",
      path,
      message: `Grep search path must be a file or directory: ${path}`,
    });
  }

  const mode = request.outputMode ?? "files_with_matches";
  const plan = createRipgrepSearchPlan(path, rootInfo, request, mode);
  const result = await runBundledRipgrep(plan.args, plan.preopens, { signal });
  throwIfAborted(signal);

  if (result.code === 2) {
    throw toRipgrepFileSystemError(result.stderr, path, pattern);
  }
  if (result.code !== 0 && result.code !== 1) {
    throw createFileSystemError({
      code: "io_error",
      path,
      message: `ripgrep exited with code ${result.code}: ${result.stderr || "unknown error"}`,
    });
  }

  const parsed =
    mode === "content"
      ? parseRipgrepJsonOutput(result.stdout, plan.outputRoot, request)
      : parseRipgrepCountOutput(result.stdout, plan.outputRoot, request);
  const files = await sortPathsByMtime(parsed.files);

  return finishTextSearchResult({
    path,
    pattern,
    mode,
    startedAt,
    request,
    files,
    entries: mode === "files_with_matches" ? [] : parsed.entries,
    numMatches: parsed.numMatches,
  });
}

export function parseRipgrepJsonOutput(
  stdout: string,
  outputRoot: string,
  request: FileSystemSearchTextRequest,
): ParsedTextSearch {
  const entries: FileSystemSearchTextEntry[] = [];
  const files = new Set<string>();
  const shouldKeep = createTextResultFilter(outputRoot, request);
  let numMatches = 0;

  for (const line of splitOutputLines(stdout)) {
    const event = parseRipgrepJsonEvent(line, request.path);
    if (event.type !== "match" && event.type !== "context") continue;

    const rawPath = event.data?.path?.text;
    if (!rawPath) continue;

    const path = resolveRipgrepOutputPath(outputRoot, rawPath);
    if (!shouldKeep(path)) continue;

    const matched = event.type === "match";
    if (matched) {
      files.add(path);
      numMatches += 1;
    }

    if (request.onlyMatching && matched) {
      const submatches = event.data?.submatches ?? [];
      if (submatches.length > 0) {
        const lineNumber =
          typeof event.data?.line_number === "number" ? event.data.line_number : undefined;
        for (const submatch of submatches) {
          entries.push(
            ...createOnlyMatchingEntries({
              path,
              text: submatch.match?.text ?? "",
              lineNumber,
            }),
          );
        }
        continue;
      }
    }

    entries.push({
      path,
      lineNumber: typeof event.data?.line_number === "number" ? event.data.line_number : undefined,
      text: stripTrailingLineEnding(event.data?.lines?.text ?? ""),
      matched,
    });
  }

  return { entries, files: [...files], numMatches };
}

export function parseRipgrepCountOutput(
  stdout: string,
  outputRoot: string,
  request: FileSystemSearchTextRequest,
): ParsedTextSearch {
  const entries: FileSystemSearchTextEntry[] = [];
  const files = new Set<string>();
  const shouldKeep = createTextResultFilter(outputRoot, request);
  let numMatches = 0;

  for (const line of splitOutputLines(stdout)) {
    const separatorIndex = line.lastIndexOf(":");
    if (separatorIndex <= 0) continue;

    const rawPath = line.slice(0, separatorIndex);
    const count = Number.parseInt(line.slice(separatorIndex + 1), 10);
    if (!Number.isFinite(count) || count <= 0) continue;

    const path = resolveRipgrepOutputPath(outputRoot, rawPath);
    if (!shouldKeep(path)) continue;

    files.add(path);
    numMatches += count;
    entries.push({ path, count });
  }

  return { entries, files: [...files], numMatches };
}

export async function sortPathsByMtime(paths: string[]): Promise<string[]> {
  const withStats = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      try {
        const info = await stat(path);
        return { path, mtimeMs: Number(info.mtimeMs) };
      } catch {
        return { path, mtimeMs: 0 };
      }
    }),
  );

  withStats.sort((left, right) => {
    const timeComparison = right.mtimeMs - left.mtimeMs;
    return timeComparison === 0 ? left.path.localeCompare(right.path) : timeComparison;
  });
  return withStats.map((item) => item.path);
}

export function parseRipgrepJsonEvent(line: string, path: string): RipgrepJsonEvent {
  try {
    return JSON.parse(line) as RipgrepJsonEvent;
  } catch (error) {
    throw createFileSystemError({
      code: "io_error",
      path,
      message: "Failed to parse ripgrep JSON output",
      cause: error,
    });
  }
}

export function resolveRipgrepOutputPath(root: string, rawPath: string): string {
  if (isAbsolute(rawPath)) return normalize(rawPath);
  const withoutLeadingDot = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
  return normalize(join(root, withoutLeadingDot));
}

export function stripTrailingLineEnding(value: string): string {
  return value.replace(/\r?\n$/, "");
}
