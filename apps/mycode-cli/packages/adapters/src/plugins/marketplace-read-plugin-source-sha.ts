import { basename, dirname } from "node:path";
import type { PluginManifest } from "@mycode/contracts";
import { isRecord } from "./helpers.js";
import {
  readPluginSourceIdentityPin,
  readRequiredPluginSourceString,
  readRequiredZipPluginSourceSha256,
  readPluginSourceHeaders,
  readOptionalZipPluginSourcePath,
  readOptionalZipPluginSourceStripRoot,
  createManifestFromMarketplaceEntry,
} from "./marketplace-read-plugin-source-identity-pin.js";
import {
  type PluginMarketplaceEntry,
  type PluginValidationDiagnostic,
  SOURCE_SHA256_PATTERN,
  type PluginMarketplaceManifest,
} from "./marketplace-marketplace-source.js";
import { pushManifestCompatibilityDiagnostics } from "./marketplace-uninstall-marketplace-plugin.js";
import { toValidationDiagnostic } from "./marketplace-ensure-marketplace-manifest-available.js";
import { loadMarketplaceManifestSync } from "./marketplace-load-marketplace-manifest-sync.js";
import { parsePluginId, qualifyDependency } from "./marketplace-update-marketplace.js";

/** 用户传入 manifest 文件时，回推对应的插件根目录。 */
export function resolveManifestRootFromFile(filePath: string): string {
  const dir = dirname(filePath);
  const dirName = basename(dir);
  return dirName.startsWith(".") && dirName.endsWith("-plugin") ? dirname(dir) : dir;
}

export function readPluginSourceSha(source: unknown): string | undefined {
  return readPluginSourceIdentityPin(source);
}

export function validateMarketplaceEntryShape(
  entry: PluginMarketplaceEntry,
  marketplace: string,
  options: { includeEntryCompatibility?: boolean } = {},
): PluginValidationDiagnostic[] {
  const diagnostics: PluginValidationDiagnostic[] = [];
  const pluginId = `${entry.name}@${marketplace}`;
  if (entry.source === undefined) {
    diagnostics.push({
      code: "plugin_marketplace_invalid",
      message: `Plugin has no install source: ${pluginId}`,
      pluginId,
      severity: "error",
    });
  }
  if (isRecord(entry.source)) {
    const sourceKind = typeof entry.source.source === "string" ? entry.source.source : "";
    if (sourceKind === "npm" || sourceKind === "pip") {
      diagnostics.push({
        code: "plugin_marketplace_source_unsupported",
        message: `Plugin source is recognized but not supported in V1 install: ${sourceKind}`,
        pluginId,
        severity: "warning",
      });
    }
    if (sourceKind === "url") {
      const sourceType = typeof entry.source.type === "string" ? entry.source.type : "";
      if (sourceType && sourceType !== "git" && sourceType !== "zip") {
        diagnostics.push({
          code: "plugin_marketplace_source_unsupported",
          message: `Plugin URL source type is not supported: ${sourceType}`,
          pluginId,
          severity: "error",
        });
      }
      try {
        readRequiredPluginSourceString(entry.source, "url", "URL");
        if (sourceType === "zip") {
          const sha256 = readRequiredZipPluginSourceSha256(entry.source).toLowerCase();
          if (!SOURCE_SHA256_PATTERN.test(sha256)) {
            throw new Error("Plugin zip source sha256 must be a 64 character hex string");
          }
          readPluginSourceHeaders(entry.source);
          readOptionalZipPluginSourcePath(entry.source);
          readOptionalZipPluginSourceStripRoot(entry.source);
        }
      } catch (error) {
        diagnostics.push({
          code: "plugin_marketplace_invalid",
          message: error instanceof Error ? error.message : String(error),
          pluginId,
          severity: "error",
        });
      }
    }
  }
  if (options.includeEntryCompatibility !== false) {
    pushEntryCompatibilityDiagnostics({ diagnostics, entry, marketplace });
  }
  return diagnostics;
}

export function pushEntryCompatibilityDiagnostics(input: {
  diagnostics: PluginValidationDiagnostic[];
  entry: PluginMarketplaceEntry;
  marketplace: string;
}): void {
  const pluginId = `${input.entry.name}@${input.marketplace}`;
  pushManifestCompatibilityDiagnostics({
    diagnostics: input.diagnostics,
    manifest: createManifestFromMarketplaceEntry(input.entry) as unknown as PluginManifest,
    manifestPath: pluginId,
    pluginId,
    source: "cache",
  });
}

export function getMarketplaceSourceValidationDeferral(
  entry: PluginMarketplaceEntry,
  marketplace: string,
): PluginValidationDiagnostic | null {
  if (!isRecord(entry.source)) return null;
  const sourceKind = typeof entry.source.source === "string" ? entry.source.source : "";
  if (sourceKind === "url") {
    const sourceType = typeof entry.source.type === "string" ? entry.source.type : "";
    if (sourceType && sourceType !== "git" && sourceType !== "zip") return null;
  }
  if (!["github", "git", "url", "git-subdir"].includes(sourceKind)) return null;
  const pluginId = `${entry.name}@${marketplace}`;
  const sourceLabel =
    typeof entry.source.repo === "string"
      ? entry.source.repo
      : typeof entry.source.url === "string"
        ? entry.source.url
        : sourceKind;
  return {
    code: "plugin_validation_deferred",

    // 聚合市场可能包含大量外部 git source；市场级 validate 不逐个 clone，单插件安装或校验时
    // 再深扫目标 root，避免设置页被网络操作拖到协议超时。
    message: `Remote plugin source validation is deferred until install or single-plugin validate: ${sourceLabel}`,
    pluginId,
    severity: "warning",
  };
}

export function pushDependencyDiagnosticsFromManifest(input: {
  diagnostics: PluginValidationDiagnostic[];
  manifest: PluginMarketplaceManifest;
  marketplace: string;
  name: string;
  storageRoot: string;
}): void {
  try {
    resolveDependencyClosureFromManifest({
      allowCrossMarketplaces: new Set(input.manifest.allowCrossMarketplaceDependenciesOn ?? []),
      marketplace: input.marketplace,
      manifest: input.manifest,
      name: input.name,
      storageRoot: input.storageRoot,
    });
  } catch (error) {
    input.diagnostics.push(toValidationDiagnostic(error, `${input.name}@${input.marketplace}`));
  }
}

export function resolveDependencyClosureFromManifest(input: {
  allowCrossMarketplaces: ReadonlySet<string>;
  marketplace: string;
  manifest: PluginMarketplaceManifest;
  name: string;
  storageRoot: string;
}): string[] {
  const rootId = `${input.name}@${input.marketplace}`;
  const closure: string[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  const loadManifest = (marketplace: string): PluginMarketplaceManifest | null =>
    marketplace === input.marketplace
      ? input.manifest
      : loadMarketplaceManifestSync(input.storageRoot, marketplace);

  const walk = (pluginId: string, requiredBy: string): void => {
    const { marketplace, name } = parsePluginId(pluginId);
    if (marketplace !== input.marketplace && !input.allowCrossMarketplaces.has(marketplace)) {
      throw new Error(
        `Cross-marketplace dependency is blocked: ${pluginId} required by ${requiredBy}`,
      );
    }
    if (visiting.includes(pluginId)) {
      throw new Error(`Plugin dependency cycle: ${[...visiting, pluginId].join(" -> ")}`);
    }
    if (visited.has(pluginId)) return;

    const manifest = loadManifest(marketplace);
    if (!manifest) throw new Error(`Marketplace not found for dependency: ${marketplace}`);
    const entry = manifest.plugins.find((plugin) => plugin.name === name);
    if (!entry) throw new Error(`Dependency not found: ${pluginId} required by ${requiredBy}`);

    visiting.push(pluginId);
    for (const dependency of entry.dependencies ?? []) {
      walk(qualifyDependency(dependency, marketplace), pluginId);
    }
    visiting.pop();
    visited.add(pluginId);
    closure.push(pluginId);
  };

  walk(rootId, rootId);
  return closure;
}
