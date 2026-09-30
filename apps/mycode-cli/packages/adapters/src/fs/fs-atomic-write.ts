import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import {
  createFileSystemError,
  type FileSystemNodeKind,
  type FileSystemSearchTextRequest,
} from "@mycode/contracts";
import {
  SymlinkWriteRefusedError,
  getNodeErrorCode,
  VCS_DIRECTORIES_TO_EXCLUDE,
} from "./fs-node-file-system-adapter-options.js";

export async function atomicWrite(path: string, content: Buffer): Promise<void> {
  let existingMode: number | undefined;

  try {
    const targetInfo = await lstat(path);
    if (targetInfo.isSymbolicLink()) {
      throw new SymlinkWriteRefusedError(
        `Refusing to write through symlink: ${path}. Resolve the symlink and pass the real target path explicitly.`,
      );
    }
    existingMode = targetInfo.mode;
  } catch (error) {
    if (getNodeErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  const tempPath = `${path}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;

  try {
    const handle = await open(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    );
    try {
      await handle.writeFile(content);
      if (existingMode !== undefined) {
        // 原子写会用临时文件 inode 覆盖目标文件；必须先复制原文件权限，避免抹掉脚本执行位。
        await handle.chmod(existingMode);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(tempPath, path);
  } catch {
    await unlink(tempPath).catch(() => undefined);
    const fallbackHandle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    ).catch((error: unknown) => {
      if (getNodeErrorCode(error) === "ELOOP") {
        throw new SymlinkWriteRefusedError(
          `Refusing to write through symlink: ${path} (O_NOFOLLOW)`,
        );
      }
      throw error;
    });

    try {
      await fallbackHandle.writeFile(content);
      await fallbackHandle.sync();
    } finally {
      await fallbackHandle.close();
    }
  }
}

export function direntKind(info: {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}): FileSystemNodeKind {
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

export interface FileSearchCandidate {
  path: string;
  mtimeMs: number;
}

export function compileSearchRegex(pattern: string, request: FileSystemSearchTextRequest): RegExp {
  try {
    const flags = `${request.ignoreCase ? "i" : ""}${request.multiline ? "s" : ""}`;
    return new RegExp(pattern, flags);
  } catch (error) {
    throw createFileSystemError({
      code: "invalid_pattern",
      path: request.path,
      message: `Invalid grep regular expression: ${pattern}`,
      cause: error,
    });
  }
}

export async function walkFiles(
  current: string,
  signal: AbortSignal | undefined,
  visitor: (path: string, info: Awaited<ReturnType<typeof stat>>) => Promise<void> | void,
): Promise<void> {
  throwIfAborted(signal);
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    throwIfAborted(signal);
    const childPath = join(current, entry.name);

    if (entry.isDirectory()) {
      if (VCS_DIRECTORIES_TO_EXCLUDE.has(entry.name)) continue;
      await walkFiles(childPath, signal, visitor);
      continue;
    }

    if (!entry.isFile()) continue;

    const info = await stat(childPath);
    await visitor(childPath, info);
  }
}

export function createGlobMatcher(
  pattern: string,
): (relativePath: string, fileName: string) => boolean {
  const normalized = normalizeGlobPattern(pattern);
  const regex = globPatternToRegExp(normalized);
  const basenameRegex = normalized.includes("/") ? undefined : globPatternToRegExp(normalized);

  return (relativePath, fileName) =>
    regex.test(relativePath) || (basenameRegex ? basenameRegex.test(fileName) : false);
}

export function normalizeGlobPattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function globPatternToRegExp(pattern: string): RegExp {
  let regex = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*") {
      if (next === "*") {
        const afterNext = pattern[index + 2];
        if (afterNext === "/") {
          regex += "(?:.*/)?";
          index += 2;
        } else {
          regex += ".*";
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    if (char === "{") {
      const end = pattern.indexOf("}", index + 1);
      if (end > index) {
        const alternatives = pattern
          .slice(index + 1, end)
          .split(",")
          .map(escapeRegExp)
          .join("|");
        regex += `(?:${alternatives})`;
        index = end;
        continue;
      }
    }

    regex += escapeRegExp(char ?? "");
  }

  regex += "$";
  try {
    return new RegExp(regex);
  } catch (error) {
    throw createFileSystemError({
      code: "invalid_pattern",
      message: `Invalid glob pattern: ${pattern}`,
      cause: error,
    });
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function toPosixRelative(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

export function matchesFileType(path: string, type: string): boolean {
  const normalized = type.toLowerCase().replace(/^\./, "");
  const extension = extname(path).toLowerCase();
  const known = TYPE_EXTENSION_MAP[normalized];
  if (known) {
    return known.includes(extension);
  }
  return extension === `.${normalized}`;
}

export const TYPE_EXTENSION_MAP: Record<string, string[]> = {
  c: [".c", ".h"],
  cpp: [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"],
  csharp: [".cs"],
  css: [".css"],
  go: [".go"],
  html: [".html", ".htm"],
  java: [".java"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  json: [".json", ".jsonc"],
  markdown: [".md", ".markdown"],
  md: [".md", ".markdown"],
  py: [".py"],
  python: [".py"],
  rs: [".rs"],
  rust: [".rs"],
  sh: [".sh", ".bash", ".zsh"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  tsx: [".tsx"],
  txt: [".txt"],
  yaml: [".yaml", ".yml"],
};

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("File system operation was cancelled");
  error.name = "AbortError";
  throw error;
}
