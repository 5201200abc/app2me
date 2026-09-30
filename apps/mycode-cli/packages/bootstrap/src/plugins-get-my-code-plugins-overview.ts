import { join, resolve, win32 } from "node:path";
import {
  createConfig,
  updatePluginEnabledInFileConfig,
  type ConfigResult,
} from "@mycode/adapters/config";
import {
  comparePluginUpdate,
  ensureDefaultPluginMarketplaces,
  listInstalledPluginRecords,
  loadKnownMarketplacesSync,
  loadMarketplaceManifestSync,
  parseEntryStoreListing,
  readPluginSourceIdentityPin,
  type MarketplaceSource,
  type PluginMarketplaceEntry,
} from "@mycode/adapters/plugins";
import type { PluginLoadOutcome, PluginMetadata, PluginStoreListing } from "@mycode/contracts";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@mycode/contracts";
import { isMyCodeCuaInternalFeatureEnabled } from "@mycode/shared";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "./app/official-plugin-definitions.js";
import {
  type ResolveMyCodePluginsOptions,
  type MyCodePluginsOverviewData,
  resolvePluginContext,
  resolveMyCodePlugins,
  type MyCodeMarketplaceSummaryData,
  countVisibleMarketplacePlugins,
  type MyCodeAvailablePluginData,
  type ListMyCodePluginsOptions,
  type SetMyCodePluginEnabledOptions,
  type SetMyCodePluginEnabledResult,
} from "./plugins-resolve-my-code-plugins-options.js";
import {
  resolveEffectiveMarketplaceRecords,
  resolveMarketplaceDeclarationDiagnostics,
  toMarketplaceSummaryData,
  toAvailablePluginData,
  toInstalledPluginData,
} from "./plugins-resolve-effective-marketplace-records.js";

export function getMyCodePluginsOverview(
  options: ResolveMyCodePluginsOptions = {},
): MyCodePluginsOverviewData {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  const outcome = resolveMyCodePlugins({
    ...options,
    configResult,
    pluginStorageRoot,
  });
  const known = loadKnownMarketplacesSync(pluginStorageRoot);
  const effectiveMarketplaces = resolveEffectiveMarketplaceRecords({
    configResult,
    known,
    workingDirectory,
  });
  const marketplaceDeclarationDiagnostics = resolveMarketplaceDeclarationDiagnostics({
    configResult,
    known,
    workingDirectory,
  });
  const installed = listInstalledPluginRecords(pluginStorageRoot);
  const installedIds = new Set(installed.map((record) => record.id));

  // 每个市场的 manifest 只读一次：同时取 entries（目录条目）与 featured（策展名单）。
  // mycode-plugins-official 的内置清单由 adapter 层提供唯一 canonical manifest。
  const catalogs: Array<{
    summary: MyCodeMarketplaceSummaryData;
    entries: PluginMarketplaceEntry[];
  }> = [];
  for (const { record, useCachedManifest } of effectiveMarketplaces) {
    // Marketplace source 只来自 User/Host 配置。只有目标 Host 已经通过显式 refresh/install
    // 物化了同一 source 时，才读取 Host cache；同 id 不同 source 必须 fail closed，避免
    // 不同 Host 或旧配置误用错误的全局 marketplace 快照。
    const manifest = useCachedManifest
      ? loadMarketplaceManifestSync(pluginStorageRoot, record.id)
      : null;
    catalogs.push({
      summary: toMarketplaceSummaryData(
        record,
        manifest?.featured,
        countVisibleMarketplacePlugins(record.id, manifest?.plugins),
      ),
      entries: manifest?.plugins ?? [],
    });
  }

  // 边遍历 marketplace catalog 边记录每个插件 id 的最新「版本 pin」用于更新检测。

  // 条目可能只有 version、只有 sha 或两者兼有，因此同时收集 version 与 sha
  // 两个轴，由 comparePluginUpdate 决定用哪条轴比对 installed 记录。
  const latestPinByPluginId = new Map<string, { version?: string; sha?: string }>();
  // 同时按 id 收集目录条目的商店信息，供已安装插件 join（详情/图标条/管理视图共用）。
  const listingByPluginId = new Map<string, PluginStoreListing>();
  const availablePlugins = catalogs.flatMap((catalog) =>
    catalog.entries.map((entry) => {
      const data = toAvailablePluginData(entry, catalog.summary.id, installedIds);
      latestPinByPluginId.set(data.id, {
        ...(entry.version ? { version: entry.version } : {}),
        ...(readPluginSourceIdentityPin(entry.source)
          ? { sha: readPluginSourceIdentityPin(entry.source) }
          : {}),
      });
      if (entry.listing) listingByPluginId.set(data.id, entry.listing);
      return data;
    }),
  );
  const loadedById = new Map(outcome.plugins.map((plugin) => [plugin.id, plugin]));

  // 被抑制（uninstall）的内置（官方）插件可一键恢复：从 OFFICIAL_PLUGIN_DEFINITIONS
  // 里挑出 id 落在 suppressedBuiltins 集合内的，映射成 available 形态供 UI 的「恢复」入口使用。
  // 完整 Catalog/cache 仍然保留，restorable 只是 Runtime 抑制态的投影，商店信息直接取定义里的 listing seed。
  const suppressed = new Set(configResult.config.plugins.suppressedBuiltins);
  const restorableBuiltins: MyCodeAvailablePluginData[] = OFFICIAL_PLUGIN_DEFINITIONS.filter(
    (def) =>
      suppressed.has(`${def.name}@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE}`) &&
      // computer-use 的恢复入口需要 internal 特性开启（与 restoreBuiltinPluginCore 同口径）。
      (def.name !== "computer-use" ||
        isMyCodeCuaInternalFeatureEnabled(options.env ?? process.env)),
  ).map((def) => {
    const listing = def.listing
      ? parseEntryStoreListing({ name: def.name, ...def.listing })
      : undefined;
    return {
      id: `${def.name}@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
      name: def.name,
      marketplace: MYCODE_OFFICIAL_PLUGIN_MARKETPLACE,
      version: def.version,
      installed: false,
      ...(listing ? { listing } : {}),
    };
  });

  return {
    marketplaces: catalogs.map((catalog) => catalog.summary),
    availablePlugins,
    installedPlugins: installed.map((record) => {
      const enabled = configResult.config.plugins.enabledPlugins[record.id] ?? false;
      const data = toInstalledPluginData(record, enabled, loadedById.get(record.id));
      const pin = latestPinByPluginId.get(record.id);
      const installedSha = readPluginSourceIdentityPin(record.source);
      const updateStatus = comparePluginUpdate({
        installedVersion: data.version,
        installedSha,
        latestVersion: pin?.version,
        latestSha: pin?.sha,
      });
      // latestVersion 展示：优先用 manifest 的 version；否则用最新 sha（短 7 位）让 UI 有可读提示。
      const latestLabel = pin?.version ?? (pin?.sha ? pin.sha.slice(0, 7) : undefined);
      const listing = listingByPluginId.get(record.id);
      return {
        ...data,
        updateStatus,
        ...(latestLabel ? { latestVersion: latestLabel } : {}),
        ...(listing ? { listing } : {}),
      };
    }),
    restorableBuiltins,
    diagnostics: [
      ...outcome.diagnostics,
      ...marketplaceDeclarationDiagnostics,
      ...known.flatMap((record): PluginLoadOutcome["diagnostics"] =>
        record.lastRefreshFailure
          ? [
              {
                code: record.lastRefreshFailure.code,
                message: record.lastRefreshFailure.message,
                pluginId: record.id,
                severity: "error",
              },
            ]
          : [],
      ),
    ],
  };
}

export function listMyCodePlugins(options: ListMyCodePluginsOptions = {}): PluginLoadOutcome {
  const outcome = resolveMyCodePlugins(options);
  const { pluginStorageRoot } = resolvePluginContext(options);
  return {
    ...outcome,
    // 用户可见名称必须从 marketplace listing 解析；这里按完整 id 传递给 CLI，
    // 不把展示元数据混入 adapter 的运行时 PluginMetadata，也不按裸 name 猜测。
    pluginListingsById: loadPluginListingsById(pluginStorageRoot),
  };
}

export function loadPluginListingsById(storageRoot: string): Record<string, PluginStoreListing> {
  const listings = new Map<string, PluginStoreListing>();

  // 没有 marketplace 快照时，bundled official definition 仍是内置插件 listing 的安全回退。
  for (const definition of OFFICIAL_PLUGIN_DEFINITIONS) {
    if (!definition.listing) continue;
    const listing = parseEntryStoreListing({ name: definition.name, ...definition.listing });
    if (listing) {
      listings.set(`${definition.name}@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE}`, listing);
    }
  }

  // 目录条目按完整 `${name}@${marketplace}` 关联；同名插件不会互相覆盖。
  for (const marketplace of loadKnownMarketplacesSync(storageRoot)) {
    const manifest = loadMarketplaceManifestSync(storageRoot, marketplace.id);
    for (const entry of manifest?.plugins ?? []) {
      if (entry.listing) listings.set(`${entry.name}@${marketplace.id}`, entry.listing);
    }
  }

  return Object.fromEntries(listings);
}

export async function setMyCodePluginEnabled(
  options: SetMyCodePluginEnabledOptions,
): Promise<SetMyCodePluginEnabledResult> {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configResult =
    options.configResult ??
    createConfig({
      env: options.env,
      projectConfigPath: options.projectConfigPath,
      workingDirectory,
      skipUserConfig: options.skipUserConfig,
      userConfigPath: options.userConfigPath,
    });
  const outcome = resolveMyCodePlugins({
    ...options,
    configResult,
    workingDirectory,
  });
  const plugin = resolvePluginSelector(options.plugin, outcome.plugins);
  const patch = await updatePluginEnabledInFileConfig(
    resolvePluginConfigPath(options, configResult, workingDirectory),
    plugin.id,
    options.enabled,
  );

  return {
    enabled: patch.enabled,
    path: patch.path,
    plugin: {
      ...plugin,
      enabled: patch.enabled,
    },
  };
}

export function applySparsePaths(
  source: MarketplaceSource,
  sparsePaths: string[] | undefined,
): MarketplaceSource {
  const paths = (sparsePaths ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (paths.length === 0) return source;
  if (source.source !== "git" && source.source !== "github") {
    throw new Error("--sparse only applies to git or GitHub marketplace sources");
  }
  return { ...source, sparsePaths: paths };
}

export function resolvePluginSelector(selector: string, plugins: PluginMetadata[]): PluginMetadata {
  const normalized = selector.trim();
  const exact = plugins.find((plugin) => plugin.id === normalized);
  if (exact) return exact;

  const nameMatches = plugins.filter((plugin) => plugin.name === normalized);
  if (nameMatches.length === 1 && nameMatches[0]) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(`Plugin name is ambiguous, use full plugin id: ${normalized}`);
  }
  throw new Error(`Plugin not found: ${normalized}`);
}

export function resolvePluginConfigPath(
  options: ResolveMyCodePluginsOptions & { scope?: "user" | "workspace" },
  configResult: ConfigResult,
  workingDirectory: string,
): string {
  if (options.scope !== "workspace") {
    return configResult.sources.user.path;
  }

  // Workspace Plugin 配置固定落在当前 `<workspace>/.mycode/config.json`。嵌套 workspace
  // 可能同时发现仓库根与自身的配置，读取端 innermost 优先；写入端也必须锁定当前
  // workspace，不能用 project discovery 的第一个 outermost 文件。
  const workspaceConfigPath = join(workingDirectory, ".mycode", "config.json");
  const projectConfigPaths = [
    ...(options.projectConfigPath ? [options.projectConfigPath] : []),
    ...configResult.sources.project.paths,
  ];
  const existingWorkspaceConfig = projectConfigPaths.find(
    (path) =>
      normalizePluginConfigPathForComparison(path) ===
      normalizePluginConfigPathForComparison(workspaceConfigPath),
  );
  if (existingWorkspaceConfig) return existingWorkspaceConfig;
  return workspaceConfigPath;
}

export function normalizePluginConfigPathForComparison(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolvedPath = platform === "win32" ? win32.resolve(path) : resolve(path);
  return platform === "win32" ? resolvedPath.replaceAll("\\", "/").toLowerCase() : resolvedPath;
}
