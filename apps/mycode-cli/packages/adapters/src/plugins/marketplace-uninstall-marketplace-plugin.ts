import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { PluginDiagnostic, PluginManifest } from "@mycode/contracts";
import { loadPluginMcpServerDefinitions, resolvePluginMcpServers } from "./mcp.js";
import { sanitizePluginId } from "./helpers.js";
import { enumeratePluginComponents, type PluginComponentGroup } from "./plugin-components.js";
import {
  type InstalledPluginRecord,
  type PluginValidationDiagnostic,
  type PluginMarketplaceEntry,
  type PluginManifestDisplayMetadata,
  UNSUPPORTED_MANIFEST_FIELDS,
} from "./marketplace-marketplace-source.js";
import {
  loadInstalledPluginsSync,
  saveInstalledPlugins,
  resolveDependencyClosure,
} from "./marketplace-update-marketplace.js";
import {
  getPluginDataDir,
  readPluginManifestFromRoot,
} from "./marketplace-read-plugin-source-identity-pin.js";
import { normalizeAuthorValue } from "./marketplace-load-known-marketplaces-sync.js";
import { loadMarketplaceManifestSync } from "./marketplace-load-marketplace-manifest-sync.js";
import { toValidationDiagnostic } from "./marketplace-ensure-marketplace-manifest-available.js";

export async function uninstallMarketplacePlugin(input: {
  pluginId: string;
  storageRoot: string;
  removeCache?: boolean;
  /** `mycode plugins uninstall --keep-data`：删安装缓存但保留 data/<plugin-id> 用户数据目录。 */
  keepData?: boolean;
}): Promise<InstalledPluginRecord | null> {
  const state = loadInstalledPluginsSync(input.storageRoot);
  const index = state.plugins.findIndex((record) => record.id === input.pluginId);
  if (index < 0) return null;
  const [removed] = state.plugins.splice(index, 1);
  await saveInstalledPlugins(input.storageRoot, state);
  if (removed && input.removeCache === true) {
    await rm(removed.installPath, { force: true, recursive: true });
    // 彻底卸载：data/<plugin-id> 是持久化的 per-plugin 目录（含 materialize 的 generated-commands）。
    // 按「卸载最后一份安装时一并删除」语义，保证重装是干净的。

    if (input.keepData !== true) {
      await rm(getPluginDataDir(input.storageRoot, removed.id), { force: true, recursive: true });
    }
  }
  return removed ?? null;
}

/** 读插件根目录的 manifest（失败按 null 降级），再交给纯枚举器列出组件名称+描述。 */
export function readComponentsAtRoot(input: {
  diagnostics: PluginValidationDiagnostic[];
  entry?: PluginMarketplaceEntry;
  marketplace: string;
  rootPath: string;
}): { components: PluginComponentGroup[]; metadata?: PluginManifestDisplayMetadata } {
  let loadedManifest: { manifest: PluginManifest; manifestPath?: string } | null = null;
  try {
    loadedManifest = readPluginManifestFromRoot(
      input.rootPath,
      input.entry ?? { name: "__describe__", raw: {} },
    );
  } catch {
    // manifest 解析失败不致命：仍可按默认目录约定扫描组件。
    loadedManifest = null;
  }
  const loaded = loadedManifest
    ? {
        id: `${loadedManifest.manifest.name}@${input.marketplace}`,
        manifest: loadedManifest.manifest,
        manifestPath: loadedManifest.manifestPath ?? input.rootPath,
        marketplace: input.marketplace,
        rootPath: input.rootPath,
        source: "cache" as const,
      }
    : undefined;
  const components = enumeratePluginComponents(input.rootPath, loadedManifest?.manifest ?? null, {
    diagnostics: input.diagnostics as PluginDiagnostic[],
    ...(loaded ? { loaded } : {}),
  });
  const metadata = loadedManifest ? toManifestDisplayMetadata(loadedManifest.manifest) : undefined;
  return { components, ...(metadata ? { metadata } : {}) };
}

/** 抽取 plugin.json 里可展示的回退字段；一个都没有时返回 undefined。 */
export function toManifestDisplayMetadata(
  manifest: PluginManifest,
): PluginManifestDisplayMetadata | undefined {
  const author = normalizeAuthorValue(manifest.author);
  const homepage =
    typeof manifest.homepage === "string" && manifest.homepage.trim().length > 0
      ? manifest.homepage
      : undefined;
  const metadata: PluginManifestDisplayMetadata = {
    ...(author?.name ? { author: author.name } : {}),
    ...(author?.url ? { authorUrl: author.url } : {}),
    ...(homepage ? { homepage } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function validatePluginRoot(input: {
  entry: PluginMarketplaceEntry;
  marketplace: string;
  rootPath: string;
  storageRoot: string;
}): PluginValidationDiagnostic[] {
  const diagnostics: PluginValidationDiagnostic[] = [];
  const pluginId = `${input.entry.name}@${input.marketplace}`;
  let loadedManifest: { manifest: PluginManifest; manifestPath?: string } | null = null;
  try {
    loadedManifest = readPluginManifestFromRoot(input.rootPath, input.entry);
  } catch (error) {
    diagnostics.push({
      code: "plugin_manifest_invalid",
      message: error instanceof Error ? error.message : String(error),
      path: input.rootPath,
      pluginId,
      severity: "error",
    });
    return diagnostics;
  }

  if (!loadedManifest) {
    diagnostics.push({
      code: "plugin_manifest_not_found",
      message: `Plugin manifest not found: ${pluginId}`,
      path: input.rootPath,
      pluginId,
      severity: "error",
    });
    return diagnostics;
  }

  const manifestPath = loadedManifest.manifestPath ?? input.rootPath;
  if (loadedManifest.manifest.name !== input.entry.name) {
    diagnostics.push({
      code: "plugin_manifest_invalid",
      message: `Plugin manifest name '${loadedManifest.manifest.name}' does not match marketplace entry '${input.entry.name}'`,
      path: manifestPath,
      pluginId,
      severity: "error",
    });
  }
  pushManifestCompatibilityDiagnostics({
    diagnostics,
    manifest: loadedManifest.manifest,
    manifestPath,
    pluginId,
    source: "cache",
  });
  pushMcpValidationDiagnostics({
    diagnostics,
    manifest: loadedManifest.manifest,
    manifestPath,
    marketplace: input.marketplace,
    pluginId,
    rootPath: input.rootPath,
    storageRoot: input.storageRoot,
  });
  return diagnostics;
}

export function pushManifestCompatibilityDiagnostics(input: {
  diagnostics: PluginValidationDiagnostic[];
  manifest: PluginManifest;
  manifestPath: string;
  pluginId: string;
  source: "cache" | "inline" | "official";
}): void {
  for (const key of UNSUPPORTED_MANIFEST_FIELDS) {
    if (key in input.manifest) {
      input.diagnostics.push({
        code: "plugin_unsupported_component",
        message: `Plugin component is diagnostic-only in this MyCode runtime: ${key}`,
        path: input.manifestPath,
        pluginId: input.pluginId,
        severity: "warning",
      });
    }
  }
  for (const [key, option] of Object.entries(input.manifest.userConfig ?? {})) {
    if (option.required === true && option.default === undefined) {
      input.diagnostics.push({
        code: "plugin_variable_missing",
        message: `Required plugin userConfig has no default and must be configured: ${key}`,
        path: input.manifestPath,
        pluginId: input.pluginId,
        severity: "warning",
      });
    }
  }
  if (containsMcpBundleSource(input.manifest.mcpServers)) {
    input.diagnostics.push({
      code: "plugin_marketplace_source_unsupported",
      message: "MCPB/DXT plugin bundles are recognized but not supported in this runtime",
      path: input.manifestPath,
      pluginId: input.pluginId,
      severity: "warning",
    });
  }
}

export function pushMcpValidationDiagnostics(input: {
  diagnostics: PluginValidationDiagnostic[];
  manifest: PluginManifest;
  manifestPath: string;
  marketplace: string;
  pluginId: string;
  rootPath: string;
  storageRoot: string;
}): void {
  const diagnostics = input.diagnostics as PluginDiagnostic[];
  const loaded = {
    id: input.pluginId,
    manifest: input.manifest,
    manifestPath: input.manifestPath,
    marketplace: input.marketplace,
    rootPath: input.rootPath,
    source: "cache" as const,
  };
  const definitions = loadPluginMcpServerDefinitions({ diagnostics, loaded });
  resolvePluginMcpServers({
    dataPath: join(input.storageRoot, "data", sanitizePluginId(input.pluginId)),
    definitions,
    diagnostics,
    env: {},
    loaded,
    options: {},
    workingDirectory: process.cwd(),
  });
}

export function containsMcpBundleSource(value: unknown): boolean {
  if (typeof value === "string") return value.endsWith(".mcpb") || value.endsWith(".dxt");
  if (Array.isArray(value)) return value.some(containsMcpBundleSource);
  return false;
}

export function pushDependencyDiagnostics(input: {
  diagnostics: PluginValidationDiagnostic[];
  marketplace: string;
  name: string;
  storageRoot: string;
}): void {
  try {
    const rootManifest = loadMarketplaceManifestSync(input.storageRoot, input.marketplace);
    resolveDependencyClosure({
      allowCrossMarketplaces: new Set(rootManifest?.allowCrossMarketplaceDependenciesOn ?? []),
      marketplace: input.marketplace,
      name: input.name,
      storageRoot: input.storageRoot,
    });
  } catch (error) {
    input.diagnostics.push(toValidationDiagnostic(error, `${input.name}@${input.marketplace}`));
  }
}
