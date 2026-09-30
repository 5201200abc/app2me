import {
  cacheMarketplacePlugin,
  resolvePluginSourceRoot,
  validateMarketplaceSource,
} from "./marketplace-source-resolution.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  appendPluginSourceCleanupError,
  cleanupPluginSourceBestEffort,
  directoryExists,
  isRecord,
} from "./helpers.js";

import { type AtomicDirectoryActivation } from "./atomic-directory.js";
import {
  type MarketplaceInstallResult,
  throwIfPluginOperationAborted,
  type InstalledPluginRecord,
  type PluginValidationDiagnostic,
  type ResolvedPluginSourceRoot,
  type DescribeMarketplacePluginResult,
  type PluginMarketplaceManifest,
} from "./marketplace-marketplace-source.js";
import {
  ensureMarketplaceManifestAvailable,
  toValidationDiagnostic,
} from "./marketplace-ensure-marketplace-manifest-available.js";
import {
  loadMarketplaceManifestSync,
  findMarketplaceManifestPath,
} from "./marketplace-load-marketplace-manifest-sync.js";
import {
  resolveDependencyClosure,
  loadInstalledPluginsSync,
  parsePluginId,
  saveInstalledPlugins,
  resolveInstalledPluginRoot,
} from "./marketplace-update-marketplace.js";
import { getMarketplaceManifestPath } from "./marketplace-load-known-marketplaces-sync.js";
import {
  pushDependencyDiagnostics,
  validatePluginRoot,
  readComponentsAtRoot,
} from "./marketplace-uninstall-marketplace-plugin.js";

import { resolveManifestRootFromFile } from "./marketplace-read-plugin-source-sha.js";
import { findPluginManifestPath } from "./marketplace-read-plugin-source-identity-pin.js";

// 组件枚举的类型定义在 plugin-components.ts；这里再导出，保持 adapter barrel 的对外契约稳定。
export type {
  PluginComponentGroup,
  PluginComponentItem,
  PluginComponentKind,
} from "./plugin-components.js";

export async function installMarketplacePlugin(input: {
  marketplace: string;
  name: string;
  signal?: AbortSignal;
  storageRoot: string;
  scope?: "user" | "workspace";
  allowCrossMarketplaces?: ReadonlySet<string>;
}): Promise<MarketplaceInstallResult> {
  await ensureMarketplaceManifestAvailable({
    marketplace: input.marketplace,
    signal: input.signal,
    storageRoot: input.storageRoot,
  });
  throwIfPluginOperationAborted(input.signal);
  const rootManifest = loadMarketplaceManifestSync(input.storageRoot, input.marketplace);
  const closure = resolveDependencyClosure({
    allowCrossMarketplaces:
      input.allowCrossMarketplaces ??
      new Set(rootManifest?.allowCrossMarketplaceDependenciesOn ?? []),
    marketplace: input.marketplace,
    name: input.name,
    storageRoot: input.storageRoot,
  });
  const state = loadInstalledPluginsSync(input.storageRoot);
  const installed: InstalledPluginRecord[] = [];
  const activations: AtomicDirectoryActivation[] = [];
  try {
    for (const pluginId of closure) {
      const { marketplace, name } = parsePluginId(pluginId);
      const manifest = loadMarketplaceManifestSync(input.storageRoot, marketplace);
      if (!manifest) throw new Error(`Marketplace not found: ${marketplace}`);
      const entry = manifest.plugins.find((plugin) => plugin.name === name);
      if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
      const cached = await cacheMarketplacePlugin({
        entry,
        marketplace,
        signal: input.signal,
        scope: input.scope ?? "user",
        state,
        storageRoot: input.storageRoot,
      });
      installed.push(cached.record);
      if (cached.activation) activations.push(cached.activation);
    }
    throwIfPluginOperationAborted(input.signal);
    await saveInstalledPlugins(input.storageRoot, state);
  } catch (error) {
    let rollbackError: unknown;
    for (const activation of activations.reverse()) {
      try {
        await activation.rollback();
      } catch (currentRollbackError) {
        rollbackError ??= currentRollbackError;
      }
    }
    throw appendPluginSourceCleanupError(error, rollbackError);
  }
  for (const activation of activations) await activation.finalize();
  return { closure, installed };
}

export async function validateMarketplacePlugin(input: {
  marketplace: string;
  name: string;
  storageRoot: string;
}): Promise<PluginValidationDiagnostic[]> {
  const diagnostics: PluginValidationDiagnostic[] = [];
  try {
    await ensureMarketplaceManifestAvailable({
      marketplace: input.marketplace,
      storageRoot: input.storageRoot,
    });
  } catch (error) {
    diagnostics.push(toValidationDiagnostic(error, `${input.name}@${input.marketplace}`));
    return diagnostics;
  }
  const manifest = loadMarketplaceManifestSync(input.storageRoot, input.marketplace);
  if (!manifest) {
    diagnostics.push({
      code: "plugin_marketplace_invalid",
      message: `Marketplace not found: ${input.marketplace}`,
      path: getMarketplaceManifestPath(input.storageRoot, input.marketplace),
      severity: "error",
    });
    return diagnostics;
  }
  const plugin = manifest.plugins.find((entry) => entry.name === input.name);
  if (!plugin) {
    diagnostics.push({
      code: "plugin_not_found",
      message: `Plugin not found: ${input.name}@${input.marketplace}`,
      path: getMarketplaceManifestPath(input.storageRoot, input.marketplace),
      severity: "error",
    });
    return diagnostics;
  }

  pushDependencyDiagnostics({
    diagnostics,
    marketplace: input.marketplace,
    name: input.name,
    storageRoot: input.storageRoot,
  });

  let resolved: ResolvedPluginSourceRoot | null = null;
  try {
    resolved = await resolvePluginSourceRoot({
      entry: plugin,
      marketplace: input.marketplace,
      storageRoot: input.storageRoot,
    });
    diagnostics.push(
      ...validatePluginRoot({
        entry: plugin,
        marketplace: input.marketplace,
        rootPath: resolved.path,
        storageRoot: input.storageRoot,
      }),
    );
  } catch (error) {
    diagnostics.push(toValidationDiagnostic(error, `${input.name}@${input.marketplace}`));
  } finally {
    await cleanupPluginSourceBestEffort(resolved?.cleanup);
  }
  return diagnostics;
}

/**
 * 按需枚举单个插件的组件「名称 + 描述」，供 marketplace 详情 UI 使用。
 * - 已安装插件：直接读本地缓存/安装目录，无需联网。
 * - 未安装候选：解析并按需临时 clone 插件源（finally 清理临时目录），参照 validateMarketplacePlugin。
 * 组件名称与描述来自组件目录的 frontmatter（command/agent 的 .md、skill 的 SKILL.md）、
 * 以及 manifest（hooks 事件名、mcpServers 名称、object 形式声明的 commands/agents）。
 * 任何一类组件读取失败都降级为「能拿到多少返回多少」+ 诊断，不抛断整个详情。
 */
export async function describeMarketplacePlugin(input: {
  marketplace: string;
  name: string;
  storageRoot: string;
}): Promise<DescribeMarketplacePluginResult> {
  const diagnostics: PluginValidationDiagnostic[] = [];
  const pluginId = `${input.name}@${input.marketplace}`;

  // 已安装优先：本地目录无需 clone，速度快且离线可用。
  const installedRecord = loadInstalledPluginsSync(input.storageRoot).plugins.find(
    (record) => record.marketplace === input.marketplace && record.name === input.name,
  );
  if (installedRecord) {
    const rootPath = resolveInstalledPluginRoot(input.storageRoot, installedRecord);
    if (directoryExists(rootPath)) {
      const read = readComponentsAtRoot({
        diagnostics,
        marketplace: input.marketplace,
        rootPath,
      });
      return {
        components: read.components,
        diagnostics,
        ...(read.metadata ? { metadata: read.metadata } : {}),
      };
    }
    // 安装记录存在但缓存缺失（被清理）——继续走源解析兜底，而不是直接报错。
  }

  let manifest: PluginMarketplaceManifest | null = null;
  try {
    await ensureMarketplaceManifestAvailable({
      marketplace: input.marketplace,
      storageRoot: input.storageRoot,
    });
    manifest = loadMarketplaceManifestSync(input.storageRoot, input.marketplace);
  } catch (error) {
    diagnostics.push(toValidationDiagnostic(error, pluginId));
    return { components: [], diagnostics };
  }
  if (!manifest) {
    diagnostics.push({
      code: "plugin_marketplace_invalid",
      message: `Marketplace not found: ${input.marketplace}`,
      path: getMarketplaceManifestPath(input.storageRoot, input.marketplace),
      severity: "error",
    });
    return { components: [], diagnostics };
  }
  const entry = manifest.plugins.find((candidate) => candidate.name === input.name);
  if (!entry) {
    diagnostics.push({
      code: "plugin_not_found",
      message: `Plugin not found: ${pluginId}`,
      path: getMarketplaceManifestPath(input.storageRoot, input.marketplace),
      severity: "error",
    });
    return { components: [], diagnostics };
  }

  let resolved: ResolvedPluginSourceRoot | null = null;
  try {
    resolved = await resolvePluginSourceRoot({
      entry,
      marketplace: input.marketplace,
      storageRoot: input.storageRoot,
    });
    const read = readComponentsAtRoot({
      diagnostics,
      entry,
      marketplace: input.marketplace,
      rootPath: resolved.path,
    });
    return {
      components: read.components,
      diagnostics,
      ...(read.metadata ? { metadata: read.metadata } : {}),
    };
  } catch (error) {
    diagnostics.push(toValidationDiagnostic(error, pluginId));
    return { components: [], diagnostics };
  } finally {
    await cleanupPluginSourceBestEffort(resolved?.cleanup);
  }
}

/**
 * 校验本地插件或 marketplace 路径，只读解析 manifest 并返回结构化诊断，不写入 storage。
 * 输入可以是目录或 manifest 文件；目录按 marketplace 优先、插件根目录其次的顺序识别。
 */
export async function validateLocalPluginPath(input: {
  path: string;
  signal?: AbortSignal;
  storageRoot: string;
}): Promise<PluginValidationDiagnostic[]> {
  const resolved = resolve(input.path);
  if (!existsSync(resolved)) {
    return [
      {
        code: "plugin_manifest_not_found",
        message: `Path does not exist: ${resolved}`,
        path: resolved,
        severity: "error",
      },
    ];
  }
  const rootPath = statSync(resolved).isDirectory()
    ? resolved
    : resolveManifestRootFromFile(resolved);
  if (findMarketplaceManifestPath(rootPath)) {
    return validateMarketplaceSource({
      signal: input.signal,
      source: { source: "directory", path: rootPath },
      storageRoot: input.storageRoot,
    });
  }
  const manifestPath = findPluginManifestPath(rootPath);
  if (!manifestPath) {
    return [
      {
        code: "plugin_manifest_not_found",
        message: `Plugin manifest not found: ${rootPath}`,
        path: rootPath,
        severity: "error",
      },
    ];
  }
  let name = "";
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    if (isRecord(parsed) && typeof parsed.name === "string") name = parsed.name.trim();
  } catch (error) {
    return [
      {
        code: "plugin_manifest_invalid",
        message: error instanceof Error ? error.message : String(error),
        path: manifestPath,
        severity: "error",
      },
    ];
  }
  // 本地目录没有 marketplace 条目：用 manifest 自己的 name 合成一个 strict 条目，
  // 让 validatePluginRoot 走与已安装插件完全相同的 manifest/MCP 校验。
  return validatePluginRoot({
    entry: { name: name || basename(rootPath), raw: {} },
    marketplace: "inline",
    rootPath,
    storageRoot: input.storageRoot,
  });
}

export type { MarketplaceSource } from "./marketplace-marketplace-source.js";
export type { PluginMarketplaceEntry } from "./marketplace-marketplace-source.js";
export type { PluginMarketplaceManifest } from "./marketplace-marketplace-source.js";
export type { KnownMarketplaceRecord } from "./marketplace-marketplace-source.js";
export type { MarketplaceRefreshFailure } from "./marketplace-marketplace-source.js";
export type { InstalledPluginRecord } from "./marketplace-marketplace-source.js";
export type { PluginValidationDiagnostic } from "./marketplace-marketplace-source.js";
export type { DescribeMarketplacePluginResult } from "./marketplace-marketplace-source.js";
export type { PluginManifestDisplayMetadata } from "./marketplace-marketplace-source.js";
export { parseMarketplaceSourceInput } from "./marketplace-marketplace-source.js";
export { loadKnownMarketplacesSync } from "./marketplace-load-known-marketplaces-sync.js";
export { ensureDefaultPluginMarketplaces } from "./marketplace-load-known-marketplaces-sync.js";
export { ensureMarketplaceManifestAvailable } from "./marketplace-ensure-marketplace-manifest-available.js";
export { addMarketplace } from "./marketplace-ensure-marketplace-manifest-available.js";
export { updateMarketplace } from "./marketplace-update-marketplace.js";
export { removeMarketplace } from "./marketplace-update-marketplace.js";
export { loadMarketplaceManifestSync } from "./marketplace-load-marketplace-manifest-sync.js";
export { listInstalledPluginRecords } from "./marketplace-update-marketplace.js";
export { resolveInstalledPluginRoot } from "./marketplace-update-marketplace.js";
export { uninstallMarketplacePlugin } from "./marketplace-uninstall-marketplace-plugin.js";
export { readPluginSourceSha } from "./marketplace-read-plugin-source-sha.js";
export { readPluginSourceIdentityPin } from "./marketplace-read-plugin-source-identity-pin.js";
export { parseEntryStoreListing } from "./marketplace-load-known-marketplaces-sync.js";
export { normalizeAuthorValue } from "./marketplace-load-known-marketplaces-sync.js";
export { getPluginDataDir } from "./marketplace-read-plugin-source-identity-pin.js";

export { validateMarketplaceSource } from "./marketplace-source-resolution.js";
