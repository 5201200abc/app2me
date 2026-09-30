import { dirname, join, resolve } from "node:path";
import {
  cleanupPluginSourceBestEffort,
  directoryExists,
  isRecord,
  resolveInside,
} from "./helpers.js";
import { isZipPluginUrlSource, resolveZipPluginSource } from "./zip-source.js";
import { activateDirectoryAtomically, type AtomicDirectoryActivation } from "./atomic-directory.js";
import {
  throwIfPluginOperationAborted,
  type InstalledPluginRecord,
  type PluginValidationDiagnostic,
  type ResolvedPluginSourceRoot,
  type PluginMarketplaceManifest,
  type MarketplaceSource,
  type LoadMarketplaceResult,
  type PluginMarketplaceEntry,
  type InstalledPluginsState,
  type CachedMarketplacePluginResult,
  INSTALLED_PLUGINS_FILE,
  DEFAULT_VERSION,
} from "./marketplace-marketplace-source.js";
import {
  toValidationDiagnostic,
  UnsupportedPluginSourceError,
} from "./marketplace-ensure-marketplace-manifest-available.js";
import { loadMarketplaceManifestSync } from "./marketplace-load-marketplace-manifest-sync.js";
import {
  getPluginCacheDir,
  resolveMarketplacePluginBaseDir,
} from "./marketplace-update-marketplace.js";
import { getMarketplaceManifestPath } from "./marketplace-load-known-marketplaces-sync.js";
import { validatePluginRoot } from "./marketplace-uninstall-marketplace-plugin.js";
import { loadMarketplaceFromSource } from "./marketplace-load-marketplace-from-source.js";
import {
  validateMarketplaceEntryShape,
  pushDependencyDiagnosticsFromManifest,
  getMarketplaceSourceValidationDeferral,
  pushEntryCompatibilityDiagnostics,
} from "./marketplace-read-plugin-source-sha.js";
import {
  assertZipPluginInstallRoot,
  resolveInstalledPluginVersion,
  ensureMarketplaceEntryManifest,
  readRequiredPluginSourceString,
  resolveRepositoryPluginSource,
  readPluginSourceIdentityPin,
  readPluginSourceHeaders,
  readOptionalZipPluginSourcePath,
  readRequiredZipPluginSourceSha256,
  readOptionalZipPluginSourceStripRoot,
  normalizeGitUrl,
} from "./marketplace-read-plugin-source-identity-pin.js";
export async function validateMarketplaceSource(input: {
  expectedId?: string;
  pluginName?: string;
  signal?: AbortSignal;
  source: MarketplaceSource;
  storageRoot: string;
}): Promise<PluginValidationDiagnostic[]> {
  const diagnostics: PluginValidationDiagnostic[] = [];
  let loaded: LoadMarketplaceResult | null = null;
  try {
    loaded = await loadMarketplaceFromSource(input.source, input.storageRoot, {
      persist: false,
      signal: input.signal,
    });
    if (input.expectedId && loaded.manifest.name !== input.expectedId) {
      diagnostics.push({
        code: "plugin_marketplace_invalid",
        message:
          `Marketplace declaration id mismatch: expected ${input.expectedId}, ` +
          `received ${loaded.manifest.name}`,
        pluginId: input.expectedId,
        severity: "error",
      });
      return diagnostics;
    }
    if (loaded.manifest.plugins.length === 0) {
      diagnostics.push({
        code: "plugin_marketplace_invalid",
        message: `Marketplace has no plugins: ${loaded.manifest.name}`,
        severity: "warning",
      });
    }
    const entries = input.pluginName
      ? loaded.manifest.plugins.filter((entry) => entry.name === input.pluginName)
      : loaded.manifest.plugins;
    if (input.pluginName && entries.length === 0) {
      diagnostics.push({
        code: "plugin_not_found",
        message: `Plugin not found: ${input.pluginName}@${loaded.manifest.name}`,
        pluginId: `${input.pluginName}@${loaded.manifest.name}`,
        severity: "error",
      });
      return diagnostics;
    }
    for (const entry of entries) {
      diagnostics.push(
        ...validateMarketplaceEntryShape(entry, loaded.manifest.name, {
          includeEntryCompatibility: false,
        }),
      );
      pushDependencyDiagnosticsFromManifest({
        diagnostics,
        manifest: loaded.manifest,
        marketplace: loaded.manifest.name,
        name: entry.name,
        storageRoot: input.storageRoot,
      });
      const deferred = getMarketplaceSourceValidationDeferral(entry, loaded.manifest.name);
      if (deferred) {
        diagnostics.push(deferred);
        pushEntryCompatibilityDiagnostics({
          diagnostics,
          entry,
          marketplace: loaded.manifest.name,
        });
        continue;
      }
      let resolved: ResolvedPluginSourceRoot | null = null;
      try {
        resolved = await resolvePluginSourceRoot({
          entry,
          marketplace: loaded.manifest.name,
          manifest: loaded.manifest,
          signal: input.signal,
          sourceRoot: loaded.sourceRoot,
          storageRoot: input.storageRoot,
        });
        diagnostics.push(
          ...validatePluginRoot({
            entry,
            marketplace: loaded.manifest.name,
            rootPath: resolved.path,
            storageRoot: input.storageRoot,
          }),
        );
      } catch (error) {
        diagnostics.push(toValidationDiagnostic(error, `${entry.name}@${loaded.manifest.name}`));
        // validate source 是 dry-run, 但也必须给 UI 展示 marketplace 条目里声明的能力风险。
        // 当远端/相对 plugin source 暂时不可解析时, 仍基于 entry 原文输出 diagnostic-only 能力诊断。
        pushEntryCompatibilityDiagnostics({
          diagnostics,
          entry,
          marketplace: loaded.manifest.name,
        });
      } finally {
        await cleanupPluginSourceBestEffort(resolved?.cleanup);
      }
    }
  } catch (error) {
    diagnostics.push(toValidationDiagnostic(error));
  } finally {
    await cleanupPluginSourceBestEffort(loaded?.cleanup);
  }
  return diagnostics;
}

export async function cacheMarketplacePlugin(input: {
  entry: PluginMarketplaceEntry;
  marketplace: string;
  signal?: AbortSignal;
  scope: "user" | "workspace";
  state: InstalledPluginsState;
  storageRoot: string;
}): Promise<CachedMarketplacePluginResult> {
  throwIfPluginOperationAborted(input.signal);
  const sourceRoot = await resolvePluginSourceRoot({
    entry: input.entry,
    marketplace: input.marketplace,
    signal: input.signal,
    storageRoot: input.storageRoot,
  });
  let version: string;
  let target: string;
  let activation: AtomicDirectoryActivation | undefined;
  try {
    // 多顶层 ZIP 未显式 path 时 resolver 会回退到 extract root，
    // 原安装流程未在删除旧 cache 前校验 manifest，仍会写 installed record 并默认启用，最终 runtime
    // 无法 discover。ZIP 源必须先确认根目录可形成合法插件；strict:false 继续复用 synthetic manifest。
    if (isZipPluginUrlSource(input.entry.source)) {
      assertZipPluginInstallRoot(sourceRoot.path, input.entry, input.marketplace);
    }
    // 缓存目录的版本段与安装记录的 version 不能取自 marketplace 条目的
    // version 字段：git/url 源插件的条目通常不带 version，取了也只会兜底成
    // "0.0.0"，导致 Root path 落到 .../<name>/0.0.0；而 UI 展示读的是插件自带 plugin.json 里的
    // 真实版本，两者割裂。因此在 clone/拷贝后的源根目录上按加载器同样的规则解析真实
    // 版本（详见 resolveInstalledPluginVersion），让缓存路径段与安装记录、UI 展示版本一致。
    version = resolveInstalledPluginVersion(sourceRoot.path, input.entry);
    target = getPluginCacheDir(input.storageRoot, input.marketplace, input.entry.name, version);
    // 内置 filesystem/sea 插件的 cachePath 即缓存目录本身，源根目录可能与 target 相同；
    // 此时无需（也不能）先 rm 再自我拷贝，否则会把源删掉。
    if (resolve(sourceRoot.path) !== resolve(target)) {
      throwIfPluginOperationAborted(input.signal);
      activation = await activateDirectoryAtomically({
        authorityPath: join(input.storageRoot, INSTALLED_PLUGINS_FILE),
        prepare: async (stagedPath) => {
          await ensureMarketplaceEntryManifest({ entry: input.entry, target: stagedPath });
        },
        signal: input.signal,
        sourcePath: sourceRoot.path,
        targetPath: target,
      });
    }
    if (resolve(sourceRoot.path) === resolve(target)) {
      await ensureMarketplaceEntryManifest({ entry: input.entry, target });
    }
  } finally {
    // cache 已复制成功后，临时目录 cleanup 失败不能阻断 installed record 落盘。
    await cleanupPluginSourceBestEffort(sourceRoot.cleanup);
  }

  const now = new Date().toISOString();
  const record: InstalledPluginRecord = {
    id: `${input.entry.name}@${input.marketplace}`,
    name: input.entry.name,
    marketplace: input.marketplace,
    version,
    installPath: target,
    installedAt: now,
    updatedAt: now,
    scope: input.scope,
    ...(input.entry.dependencies ? { dependencies: input.entry.dependencies } : {}),
    ...(input.entry.source !== undefined ? { source: input.entry.source } : {}),
    ...(activation ? { cacheTransactionId: activation.transactionId } : {}),
  };
  const existingIndex = input.state.plugins.findIndex((plugin) => plugin.id === record.id);
  if (existingIndex >= 0) {
    const { cacheTransactionId: _previousCacheTransactionId, ...previousRecord } =
      input.state.plugins[existingIndex] ?? record;
    input.state.plugins[existingIndex] = {
      ...previousRecord,
      ...record,
      installedAt: previousRecord.installedAt ?? record.installedAt,
    };
  } else {
    input.state.plugins.push(record);
  }
  return { ...(activation ? { activation } : {}), record };
}

export async function resolvePluginSourceRoot(input: {
  entry: PluginMarketplaceEntry;
  manifest?: PluginMarketplaceManifest;
  marketplace: string;
  signal?: AbortSignal;
  sourceRoot?: string;
  storageRoot: string;
}): Promise<ResolvedPluginSourceRoot> {
  throwIfPluginOperationAborted(input.signal);
  const source = input.entry.source;
  const marketplaceDir =
    input.sourceRoot ?? dirname(getMarketplaceManifestPath(input.storageRoot, input.marketplace));
  const manifest =
    input.manifest ?? loadMarketplaceManifestSync(input.storageRoot, input.marketplace);
  const pluginBaseDir = resolveMarketplacePluginBaseDir(marketplaceDir, manifest);
  // 内置 official 插件 seed 到 marketplace.json 时 source 写的是裸 kind 字符串
  // "filesystem"/"sea"（见 bootstrap/app/bundled-plugins.ts writeOfficialMarketplace），
  // 原逻辑落到下面的 `typeof source === "string"` 分支，把 "filesystem" 当相对路径解析后抛
  // "Unsupported or missing plugin source: filesystem"，导致市场详情页对内置插件枚举不出组件。
  // 这类插件已落盘在 cachePath（缺失时按 cache/<marketplace>/<name>/<version> 兜底），直接定位即可。
  if (source === "filesystem" || source === "sea") {
    const cachePath = input.entry.cachePath;
    if (cachePath && directoryExists(cachePath)) return { path: cachePath };
    const computed = getPluginCacheDir(
      input.storageRoot,
      input.marketplace,
      input.entry.name,
      input.entry.version ?? DEFAULT_VERSION,
    );
    if (directoryExists(computed)) return { path: computed };
    throw new Error(
      `Bundled plugin cache directory missing: ${input.entry.name}@${input.marketplace}`,
    );
  }
  if (typeof source === "string") {
    const local = resolveInside(pluginBaseDir, source.replace(/^\.\//, ""));
    if (local && directoryExists(local)) return { path: local };
    const fallback = resolve(source);
    if (directoryExists(fallback)) return { path: fallback };
    throw new Error(`Unsupported or missing plugin source: ${source}`);
  }
  if (isRecord(source)) {
    const sourceKind = typeof source.source === "string" ? source.source : "";
    if (sourceKind === "directory") {
      const path = resolve(readRequiredPluginSourceString(source, "path", "directory path"));
      if (directoryExists(path)) return { path };
      throw new Error(`Plugin source directory does not exist: ${path}`);
    }
    if (sourceKind === "github") {
      const repo = readRequiredPluginSourceString(source, "repo", "GitHub repo");
      const url = `https://github.com/${repo}.git`;
      return resolveRepositoryPluginSource({
        path: typeof source.path === "string" ? source.path : undefined,
        ref: typeof source.ref === "string" ? source.ref : undefined,
        signal: input.signal,
        sha: readPluginSourceIdentityPin(source),
        url,
      });
    }
    if (sourceKind === "git") {
      return resolveRepositoryPluginSource({
        path: typeof source.path === "string" ? source.path : undefined,
        ref: typeof source.ref === "string" ? source.ref : undefined,
        signal: input.signal,
        sha: readPluginSourceIdentityPin(source),
        url: readRequiredPluginSourceString(source, "url", "Git URL"),
      });
    }
    if (sourceKind === "url") {
      const url = readRequiredPluginSourceString(source, "url", "URL");
      const sourceType = typeof source.type === "string" ? source.type : "";
      if (sourceType === "zip") {
        return resolveZipPluginSource({
          headers: readPluginSourceHeaders(source),
          path: readOptionalZipPluginSourcePath(source),
          sha256: readRequiredZipPluginSourceSha256(source),
          signal: input.signal,
          stripRoot: readOptionalZipPluginSourceStripRoot(source),
          url,
        });
      }
      if (sourceType && sourceType !== "git") {
        throw new UnsupportedPluginSourceError(`url:${sourceType}`);
      }
      return resolveRepositoryPluginSource({
        path: typeof source.path === "string" ? source.path : undefined,
        ref: typeof source.ref === "string" ? source.ref : undefined,
        signal: input.signal,
        sha: readPluginSourceIdentityPin(source),
        url,
      });
    }
    if (sourceKind === "git-subdir") {
      return resolveRepositoryPluginSource({
        path: readRequiredPluginSourceString(source, "path", "git-subdir path"),
        ref: typeof source.ref === "string" ? source.ref : undefined,
        signal: input.signal,
        sha: readPluginSourceIdentityPin(source),
        url: normalizeGitUrl(readRequiredPluginSourceString(source, "url", "git-subdir URL")),
      });
    }
    if (sourceKind === "npm" || sourceKind === "pip") {
      throw new UnsupportedPluginSourceError(sourceKind);
    }
    // 显式 object source 配置错误时不能降级到 marketplace 内同名目录，否则会安装错误来源。
    throw new Error(
      `Plugin source is invalid or unsupported for ${input.entry.name}@${input.marketplace}: ${sourceKind || "missing kind"}`,
    );
  }
  const localByName = join(pluginBaseDir, input.entry.name);
  if (directoryExists(localByName)) return { path: localByName };
  throw new Error(`Plugin source is not supported for ${input.entry.name}@${input.marketplace}`);
}
