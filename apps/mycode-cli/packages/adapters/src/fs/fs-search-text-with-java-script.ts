import { readFile, stat } from "node:fs/promises";
import type { RgArg } from "ripgrep";
import {
  createFileSystemError,
  type FileSystemSearchTextEntry,
  type FileSystemTextSearchOutputMode,
  type FileSystemSearchTextRequest,
  type FileSystemSearchTextResult,
} from "@mycode/contracts";
import {
  resolveAbsoluteRequestPath,
  toFileSystemError,
  DEFAULT_GREP_HEAD_LIMIT,
} from "./fs-node-file-system-adapter-options.js";
import { throwIfAborted, compileSearchRegex } from "./fs-atomic-write.js";
import {
  collectTextSearchCandidates,
  looksBinary,
  searchMultilineContent,
  type TextSearchResult,
  splitRipgrepSearchLines,
  createOnlyMatchingSearchResult,
  createContextLineIndexes,
  type OnlyMatchingMatches,
  createOnlyMatchingEntries,
} from "./fs-text-search-result.js";

export async function searchTextWithJavaScript(
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

  try {
    throwIfAborted(signal);
    const regex = compileSearchRegex(pattern, request);
    const rootInfo = await stat(path);
    const mode = request.outputMode ?? "files_with_matches";
    const candidates = await collectTextSearchCandidates(path, rootInfo, request, signal);

    const searchRequest = mode === "content" ? request : { ...request, onlyMatching: false };
    const contentEntries: FileSystemSearchTextEntry[] = [];
    const countEntries: FileSystemSearchTextEntry[] = [];
    const matchingFiles: Array<{ path: string; mtimeMs: number }> = [];
    let numMatches = 0;

    for (const candidate of candidates) {
      throwIfAborted(signal);
      const content = await readFile(candidate.path, "utf8");
      if (looksBinary(content)) continue;

      const search = request.multiline
        ? searchMultilineContent(candidate.path, content, regex, searchRequest)
        : searchLineContent(candidate.path, content, regex, searchRequest);

      if (search.matchCount === 0) continue;

      numMatches += search.matchCount;
      matchingFiles.push({ path: candidate.path, mtimeMs: candidate.mtimeMs });
      if (mode === "content") {
        contentEntries.push(...search.entries);
      } else if (mode === "count") {
        countEntries.push({
          path: candidate.path,
          count: search.matchCount,
        });
      }
    }

    matchingFiles.sort((left, right) => {
      const timeComparison = right.mtimeMs - left.mtimeMs;
      return timeComparison === 0 ? left.path.localeCompare(right.path) : timeComparison;
    });

    return finishTextSearchResult({
      path,
      pattern,
      mode,
      startedAt,
      request,
      files: matchingFiles.map((item) => item.path),
      entries: mode === "content" ? contentEntries : countEntries,
      numMatches,
    });
  } catch (error) {
    throw toFileSystemError(error, path);
  }
}

export interface RipgrepSearchPlan {
  args: RgArg[];
  outputRoot: string;
  preopens: Record<string, string>;
}

export interface FinishTextSearchParams {
  path: string;
  pattern: string;
  mode: FileSystemTextSearchOutputMode;
  startedAt: number;
  request: FileSystemSearchTextRequest;
  files: string[];
  entries: FileSystemSearchTextEntry[];
  numMatches: number;
}

export function addRipgrepContextArgs(args: RgArg[], request: FileSystemSearchTextRequest): void {
  if (request.context !== undefined) {
    args.push("-C", String(request.context));
    return;
  }
  if (request.beforeContext !== undefined) {
    args.push("-B", String(request.beforeContext));
  }
  if (request.afterContext !== undefined) {
    args.push("-A", String(request.afterContext));
  }
}

export function addRipgrepGlobArgs(args: RgArg[], glob: string): void {
  for (const pattern of splitRipgrepGlobPatterns(glob)) {
    args.push("--glob", pattern);
  }
}

export function splitRipgrepGlobPatterns(glob: string): string[] {
  const patterns: string[] = [];
  for (const rawPattern of glob.split(/\s+/)) {
    if (rawPattern.includes("{") && rawPattern.includes("}")) {
      patterns.push(rawPattern);
      continue;
    }
    patterns.push(...rawPattern.split(","));
  }
  return patterns.map((pattern) => pattern.trim()).filter(Boolean);
}

export function finishTextSearchResult(params: FinishTextSearchParams): FileSystemSearchTextResult {
  if (params.mode === "files_with_matches") {
    const limited = applyHeadLimit(params.files, params.request.headLimit, params.request.offset);
    return {
      path: params.path,
      pattern: params.pattern,
      mode: params.mode,
      durationMs: Math.max(0, Date.now() - params.startedAt),
      files: limited.items,
      entries: [],
      numMatches: params.numMatches,
      truncated: limited.truncated,
      appliedLimit: limited.appliedLimit,
      appliedOffset: limited.appliedOffset,
    };
  }

  const limited = applyHeadLimit(params.entries, params.request.headLimit, params.request.offset);
  return {
    path: params.path,
    pattern: params.pattern,
    mode: params.mode,
    durationMs: Math.max(0, Date.now() - params.startedAt),
    files: params.files,
    entries: limited.items,
    numMatches: params.numMatches,
    truncated: limited.truncated,
    appliedLimit: limited.appliedLimit,
    appliedOffset: limited.appliedOffset,
  };
}

export function searchLineContent(
  path: string,
  content: string,
  regex: RegExp,
  request: FileSystemSearchTextRequest,
): TextSearchResult {
  const lines = splitRipgrepSearchLines(content);

  if (request.onlyMatching) {
    return createOnlyMatchingSearchResult({
      path,
      lines,
      request,
      matches: collectLineOnlyMatchingMatches(path, lines, regex),
    });
  }

  const matchingIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[index] ?? "")) {
      matchingIndexes.push(index);
    }
  }

  const ranges = matchingIndexes.map((index) => ({ start: index, end: index }));
  const matchedLineIndexes = new Set(matchingIndexes);
  const entries = createContextLineIndexes(lines.length, ranges, request).map((lineIndex) => ({
    path,
    lineNumber: lineIndex + 1,
    text: lines[lineIndex] ?? "",
    matched: matchedLineIndexes.has(lineIndex),
  }));

  return {
    matchCount: matchingIndexes.length,
    entries,
  };
}

export function collectLineOnlyMatchingMatches(
  path: string,
  lines: string[],
  regex: RegExp,
): OnlyMatchingMatches {
  const entriesByLine = new Map<number, FileSystemSearchTextEntry[]>();
  const globalRegex = new RegExp(regex.source, `${regex.ignoreCase ? "i" : ""}g`);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const entries: FileSystemSearchTextEntry[] = [];
    globalRegex.lastIndex = 0;
    for (const match of line.matchAll(globalRegex)) {
      entries.push(
        ...createOnlyMatchingEntries({
          path,
          lineNumber: lineIndex + 1,
          text: match[0],
        }),
      );
    }
    if (entries.length > 0) {
      entriesByLine.set(lineIndex, entries);
    }
  }

  return {
    matchCount: entriesByLine.size,
    ranges: Array.from(entriesByLine.keys()).map((lineIndex) => ({
      start: lineIndex,
      end: lineIndex,
    })),
    entriesByLine,
  };
}

export function applyHeadLimit<T>(
  items: T[],
  headLimit: number | undefined,
  offset = 0,
): { items: T[]; appliedLimit?: number; appliedOffset?: number; truncated: boolean } {
  if (headLimit === 0) {
    return {
      items: items.slice(offset),
      appliedOffset: offset > 0 ? offset : undefined,
      truncated: false,
    };
  }

  const effectiveLimit = headLimit ?? DEFAULT_GREP_HEAD_LIMIT;
  const sliced = items.slice(offset, offset + effectiveLimit);
  const truncated = items.length - offset > effectiveLimit;

  return {
    items: sliced,
    appliedLimit: truncated ? effectiveLimit : undefined,
    appliedOffset: offset > 0 ? offset : undefined,
    truncated,
  };
}
