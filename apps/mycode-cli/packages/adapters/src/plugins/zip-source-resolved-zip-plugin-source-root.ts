import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import * as yauzl from "yauzl";
import { createNodeWebFetchHttpClientAdapter } from "../http/index.js";

export const ZIP_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

export const ZIP_EXTRACT_MAX_BYTES = 500 * 1024 * 1024;

export const ZIP_MAX_ENTRIES = 20_000;

export const ZIP_MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

export const ZIP_MAX_REDIRECTS = 5;

export const ZIP_DOWNLOAD_TIMEOUT_MS = 180_000;

export const ZIP_TEMP_PREFIX = "mycode-plugin-zip-";

export const ZIP_DENIED_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
]);

export const ZIP_REQUIRED_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface ResolvedZipPluginSourceRoot {
  cleanup: () => Promise<void>;
  path: string;
}

export interface ResolveZipPluginSourceInput {
  headers?: Record<string, string>;
  path?: string;
  sha256: string;
  signal?: AbortSignal;
  stripRoot?: boolean;
  url: string;
}

export interface ResolveHttpZipSourceInput {
  headers?: Record<string, string>;
  path?: string;
  requireSingleRoot?: boolean;
  sha256?: string;
  signal?: AbortSignal;
  stripRoot?: boolean;
  url: string;
}

export class PluginZipDownloadError extends Error {
  readonly status?: number;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "PluginZipDownloadError";
    this.url = url;
    if (status !== undefined) this.status = status;
  }
}

export interface ZipExtractResult {
  topLevelSegments: Set<string>;
}

export type ZipEntryKind = "directory" | "file";

export function validateZipSourceInput(input: ResolveZipPluginSourceInput): void {
  validateZipDownloadUrl(input.url);
  if (!ZIP_REQUIRED_SHA256_PATTERN.test(input.sha256.toLowerCase())) {
    throw new Error("Plugin zip source sha256 must be a 64 character hex string");
  }
  validateZipHeaders(input.headers);
  if (input.path !== undefined) {
    normalizeZipRelativePath(input.path);
  }
}

export async function downloadZipArchive(input: {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  url: string;
}): Promise<Uint8Array> {
  // agent 会封存用户 shell 代理，ZIP 下载必须和其他应用层 fetch 一样读取 captured proxy fallback。
  const client = createNodeWebFetchHttpClientAdapter({
    env: process.env,
    maxResponseBytes: ZIP_DOWNLOAD_MAX_BYTES,
    timeoutMs: ZIP_DOWNLOAD_TIMEOUT_MS,
  });
  let currentUrl = input.url;
  let currentHeaders = input.headers;
  for (let redirectCount = 0; redirectCount <= ZIP_MAX_REDIRECTS; redirectCount += 1) {
    throwIfAborted(input.signal);
    validateZipDownloadUrl(currentUrl);
    const response = await client.request(
      {
        headers: currentHeaders,
        maxResponseBytes: ZIP_DOWNLOAD_MAX_BYTES,
        method: "GET",
        redirect: "manual",
        url: currentUrl,
      },
      { signal: input.signal },
    );

    if (isRedirectStatus(response.status)) {
      const location = response.headers.location;
      if (!location) {
        throw new Error(`Plugin zip download redirect is missing Location header: ${currentUrl}`);
      }
      const redirectUrl = new URL(location, currentUrl);
      // 跨 CDN origin 继续发送 marketplace 自定义 header 会把内部元数据泄露给跳转目标。
      if (redirectUrl.origin !== new URL(currentUrl).origin) {
        currentHeaders = undefined;
      }
      currentUrl = redirectUrl.toString();
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new PluginZipDownloadError(
        `Failed to download plugin zip: ${response.status} ${response.statusText}`,
        currentUrl,
        response.status,
      );
    }
    return response.body;
  }
  throw new Error(`Plugin zip download exceeded redirect limit: ${input.url}`);
}

export function openZipFile(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      if (!zipFile) {
        rejectPromise(new Error("Failed to open plugin zip archive"));
        return;
      }
      resolvePromise(zipFile);
    });
  });
}

export function classifyZipEntry(entry: yauzl.Entry): ZipEntryKind {
  const isDirectoryByName = entry.fileName.endsWith("/");
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`Encrypted plugin zip entries are not supported: ${entry.fileName}`);
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  if (fileType === 0o120000) {
    throw new Error(`Plugin zip entry symlinks are not supported: ${entry.fileName}`);
  }
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new Error(`Unsupported plugin zip entry type: ${entry.fileName}`);
  }
  if (fileType === 0o040000 || isDirectoryByName) return "directory";
  return "file";
}

export function normalizeZipRelativePath(path: string): string {
  if (path.includes("\0")) {
    throw new Error(`Unsafe plugin zip path: ${path}`);
  }
  const withoutTrailingSlash = path.replace(/\/+$/u, "");
  if (
    !withoutTrailingSlash ||
    path.includes("\\") ||
    isAbsolute(path) ||
    posix.isAbsolute(path) ||
    /^[a-zA-Z]:/u.test(path)
  ) {
    throw new Error(`Unsafe plugin zip path: ${path}`);
  }
  const parts = withoutTrailingSlash.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe plugin zip path: ${path}`);
  }
  return withoutTrailingSlash;
}

export function resolveZipPathWithin(rootPath: string, relativePath: string): string {
  const root = resolve(rootPath);
  const target = resolve(root, ...relativePath.split("/"));
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Unsafe plugin zip path: ${relativePath}`);
  }
  return target;
}

export function validateZipHeaders(headers: Record<string, string> | undefined): void {
  if (!headers) return;
  for (const [key, value] of Object.entries(headers)) {
    if (ZIP_DENIED_HEADERS.has(key.toLowerCase())) {
      throw new Error(`Plugin zip source header is not allowed: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`Plugin zip source header must be a string: ${key}`);
    }
  }
}

export function validateZipDownloadUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Plugin zip source URL is invalid: ${value}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new Error(`Plugin zip source URL must be HTTPS: ${value}`);
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    isIpv4LoopbackHost(normalized)
  );
}

export function isIpv4LoopbackHost(hostname: string): boolean {
  const match = /^127(?:\.(\d{1,3})){3}$/u.exec(hostname);
  if (!match) return false;
  return hostname
    .split(".")
    .every((part) => Number.parseInt(part, 10) >= 0 && Number.parseInt(part, 10) <= 255);
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Plugin operation cancelled");
    error.name = "AbortError";
    throw error;
  }
}
