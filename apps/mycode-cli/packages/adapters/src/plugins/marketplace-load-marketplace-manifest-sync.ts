import { basename, dirname, join } from "node:path";
import { fileExists, isRecord, resolveInside } from "./helpers.js";
import { createNodeWebFetchHttpClientAdapter } from "../http/index.js";
import {
  activateDirectoryAtomically,
  recoverAtomicTargetSync,
  writeFileAtomically,
  type AtomicDirectoryActivation,
} from "./atomic-directory.js";
import { createGitUnavailableError, isCommandUnavailableError } from "./source-errors.js";
import {
  MARKETPLACE_JSON_TIMEOUT_MS,
  MARKETPLACE_JSON_MAX_BYTES,
  MARKETPLACE_JSON_MAX_REDIRECTS,
  type PluginMarketplaceManifest,
  readJsonFileSync,
  throwIfPluginOperationAborted,
  execFileAsync,
  buildMarketplaceGitEnv,
  GIT_COMMAND_TIMEOUT_MS,
  KNOWN_MARKETPLACES_FILE,
  MARKETPLACE_FILE,
  MARKETPLACE_NAME_PATTERN,
  type PluginMarketplaceEntry,
  CLAUDE_MARKETPLACE_FILE,
} from "./marketplace-marketplace-source.js";
import {
  getMarketplaceManifestPath,
  isPluginMarketplaceManifest,
  normalizeDependencyRef,
  parseEntryStoreListing,
} from "./marketplace-load-known-marketplaces-sync.js";

export async function requestMarketplaceJson(
  url: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs = MARKETPLACE_JSON_TIMEOUT_MS,
): Promise<unknown> {
  const client = createNodeWebFetchHttpClientAdapter({
    env: process.env,
    maxResponseBytes: MARKETPLACE_JSON_MAX_BYTES,
    timeoutMs,
  });
  let currentHeaders = headers;
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MARKETPLACE_JSON_MAX_REDIRECTS; redirectCount += 1) {
    const response = await client.request(
      {
        ...(currentHeaders ? { headers: currentHeaders } : {}),
        method: "GET",
        redirect: "manual",
        url: currentUrl,
      },
      { signal },
    );
    if (isMarketplaceJsonRedirectStatus(response.status)) {
      const location = response.headers.location;
      if (!location) {
        throw new Error(`Marketplace redirect is missing Location header: ${currentUrl}`);
      }
      const redirectUrl = new URL(location, currentUrl);
      // 代理/自定义 CA 分支的 http.request 不会执行 redirect:follow；
      // 这里统一有界跟随，并在跨 origin 时清理市场自定义 header，避免凭据泄露给 CDN。
      if (redirectUrl.origin !== new URL(currentUrl).origin) {
        currentHeaders = undefined;
      }
      currentUrl = redirectUrl.toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to fetch marketplace: ${response.status} ${response.statusText}`);
    }
    return JSON.parse(new TextDecoder().decode(response.body)) as unknown;
  }
  throw new Error(`Marketplace fetch exceeded redirect limit: ${url}`);
}

export function isMarketplaceJsonRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function loadMarketplaceManifestSync(
  storageRoot: string,
  marketplace: string,
): PluginMarketplaceManifest | null {
  const manifestPath = getMarketplaceManifestPath(storageRoot, marketplace);
  // 崩溃残留先恢复；若 writer 仍活跃，则在权威 known state 落盘前读 backup，
  // 落盘后读新 target，避免 overview 看见跨代 manifest/summary。
  const readableDirectory = recoverAtomicTargetSync(dirname(manifestPath));
  const parsed = readJsonFileSync(join(readableDirectory, basename(manifestPath)));
  return parseMarketplaceManifest(parsed);
}

export async function execGitCommand(args: string[], signal?: AbortSignal): Promise<void> {
  throwIfPluginOperationAborted(signal);
  try {
    // 显式二进制覆盖既支持非标准 Git 安装位置，也让跨进程 E2E 能把 Git 指向不存在的
    // 绝对路径，真实证明 Archive 主链路不依赖开发机上偶然存在的 Git。
    const gitBinary = process.env.MYCODE_GIT_BINARY?.trim() || "git";
    await execFileAsync(gitBinary, args, {
      env: buildMarketplaceGitEnv(),
      killSignal: "SIGTERM",
      maxBuffer: 1024 * 1024 * 10,
      signal,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    if (isCommandUnavailableError(error)) {
      const source = args.find(
        (arg) => arg.includes("://") || arg.startsWith("git@") || arg.startsWith("git+"),
      );
      throw createGitUnavailableError(source ?? args.at(-1) ?? "Git operation");
    }
    throw error;
  }
  throwIfPluginOperationAborted(signal);
}

export function isRetryableGitCloneError(error: unknown): boolean {
  const output = getErrorOutput(error);
  return /RPC failed|Operation timed out|Recv failure|expected flush|early EOF|remote end hung up|HTTP\/2 stream|Connection reset|ETIMEDOUT|ECONNRESET|network timeout/iu.test(
    output,
  );
}

export function getErrorOutput(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  const chunks = [
    error instanceof Error ? error.message : "",
    typeof error.stdout === "string" ? error.stdout : "",
    typeof error.stderr === "string" ? error.stderr : "",
  ];
  return chunks.filter(Boolean).join("\n");
}

export async function stageMarketplaceDirectoryPlugins(
  sourceDir: string,
  storageRoot: string,
  marketplace: string,
  manifest: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AtomicDirectoryActivation> {
  throwIfPluginOperationAborted(signal);
  const targetDir = dirname(getMarketplaceManifestPath(storageRoot, marketplace));
  return activateDirectoryAtomically({
    authorityPath: join(storageRoot, KNOWN_MARKETPLACES_FILE),
    prepare: async (stagedPath) => {
      await writeJsonFile(join(stagedPath, MARKETPLACE_FILE), manifest);
    },
    signal,
    sourcePath: sourceDir,
    targetPath: targetDir,
  });
}

export function parseRequiredMarketplaceManifest(value: unknown): PluginMarketplaceManifest {
  const parsed = parseMarketplaceManifest(value);
  if (!parsed) throw new Error("Marketplace manifest is invalid");
  return parsed;
}

export function parseMarketplaceManifest(value: unknown): PluginMarketplaceManifest | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!MARKETPLACE_NAME_PATTERN.test(name)) return null;
  const rawPlugins = value.plugins;
  const pluginEntries = Array.isArray(rawPlugins)
    ? rawPlugins
    : isRecord(rawPlugins)
      ? Object.entries(rawPlugins).map(([pluginName, plugin]) =>
          isRecord(plugin) ? { name: pluginName, ...plugin } : { name: pluginName },
        )
      : [];
  return normalizeMarketplaceManifest({
    ...value,
    name,
    plugins: pluginEntries,
  });
}

export function normalizeMarketplaceManifest(
  value: PluginMarketplaceManifest | Record<string, unknown>,
): PluginMarketplaceManifest {
  if (isPluginMarketplaceManifest(value)) return value;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const plugins = Array.isArray(value.plugins)
    ? value.plugins
        .filter(isRecord)
        .map((entry): PluginMarketplaceEntry | null => {
          const name = typeof entry.name === "string" ? entry.name.trim() : "";
          if (name.length === 0) return null;
          const dependencies = Array.isArray(entry.dependencies)
            ? entry.dependencies
                .map(normalizeDependencyRef)
                .filter((item): item is string => item !== null)
            : undefined;
          const tags = Array.isArray(entry.tags)
            ? entry.tags.filter((item): item is string => typeof item === "string")
            : undefined;
          const listing = parseEntryStoreListing(entry);
          return {
            name,
            ...(typeof entry.category === "string" ? { category: entry.category } : {}),
            ...(typeof entry.description === "string" ? { description: entry.description } : {}),
            ...(typeof entry.version === "string" ? { version: entry.version } : {}),
            ...(entry.source !== undefined ? { source: entry.source } : {}),
            ...(typeof entry.cachePath === "string" ? { cachePath: entry.cachePath } : {}),
            ...(dependencies ? { dependencies } : {}),
            ...(typeof entry.strict === "boolean" ? { strict: entry.strict } : {}),
            ...(tags ? { tags } : {}),
            ...(listing ? { listing } : {}),
            raw: entry,
          };
        })
        .filter((entry): entry is PluginMarketplaceEntry => entry !== null)
    : [];
  const allowCrossMarketplaceDependenciesOn = Array.isArray(
    value.allowCrossMarketplaceDependenciesOn,
  )
    ? value.allowCrossMarketplaceDependenciesOn.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  // 目录顶层的 Featured 策展名单：仅接受非空字符串数组，去掉空白项。
  const featured = Array.isArray(value.featured)
    ? value.featured.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : undefined;
  return {
    name: String(value.name),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : typeof metadata.description === "string"
        ? { description: metadata.description }
        : {}),
    plugins,
    ...(allowCrossMarketplaceDependenciesOn ? { allowCrossMarketplaceDependenciesOn } : {}),
    ...(typeof metadata.pluginRoot === "string" ? { pluginRoot: metadata.pluginRoot } : {}),
    ...(featured && featured.length > 0 ? { featured } : {}),
    raw: value,
  };
}

export function findMarketplaceManifestPath(
  rootPath: string,
  explicitPath?: string,
): string | null {
  const candidates = [
    ...(explicitPath ? [explicitPath] : []),
    CLAUDE_MARKETPLACE_FILE,
    MARKETPLACE_FILE,
  ];
  for (const candidate of candidates) {
    const path = resolveInside(rootPath, candidate);
    if (path && fileExists(path)) return path;
  }
  return null;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}
