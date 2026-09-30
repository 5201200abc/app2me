import { dirname, isAbsolute, resolve } from "node:path";
import { createConfig, resolvePath, type ConfigResult } from "@mycode/adapters/config";
import {
  discoverNodePluginsSync,
  type KnownMarketplaceRecord,
  type MarketplaceSource,
} from "@mycode/adapters/plugins";
import type {
  Logger,
  PluginHookDetail,
  PluginLoadOutcome,
  PluginMetadata,
  PluginStoreListing,
} from "@mycode/contracts";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@mycode/contracts";
import { resolveOfficialPluginRoots } from "./app/bundled-plugins.js";
import {
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
  OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
} from "./app/official-plugin-definitions.js";
import { getCliStorageRoot, getPluginStorageRoot } from "./app/paths.js";

export interface ResolveMyCodePluginsOptions {
  configResult?: ConfigResult;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  officialPluginRoots?: string[];
  pluginStorageRoot?: string;
  projectConfigPath?: string;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  workingDirectory?: string;
}

export interface ListMyCodePluginsOptions extends ResolveMyCodePluginsOptions {}

export interface SetMyCodePluginEnabledOptions extends ResolveMyCodePluginsOptions {
  enabled: boolean;
  plugin: string;
  scope?: "user" | "workspace";
}

export interface SetMyCodePluginEnabledResult {
  enabled: boolean;
  path: string;
  plugin: PluginMetadata;
}

export interface MyCodeMarketplaceSummaryData {
  id: string;
  name: string;
  source: Record<string, unknown>;
  description?: string;
  lastUpdated?: string;
  pluginCount: number;
  isOfficial: boolean;
  refreshFailure?: {
    code: string;
    failedAt: string;
    message: string;
  };
  // 目录顶层 featured 策展名单（商店「公开」分段 Featured 区），随 manifest 下发。
  featured?: string[];
}

export interface MyCodeAvailablePluginData {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installed: boolean;
  componentTypes?: string[];
  hookDetails?: PluginHookDetail[];
  // 商店信息（显示名/icon/分类/作者/链接/hero/示例提示词），来自目录条目。
  listing?: PluginStoreListing;
}

export interface MyCodeInstalledPluginData {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  enabled: boolean;
  scope: "user" | "workspace";
  installPath?: string;
  installedAt?: string;
  componentTypes?: string[];
  hookDetails?: PluginHookDetail[];
  updateStatus?: "none" | "update-available" | "version-changed";
  latestVersion?: string;
  // 已安装插件的商店信息由目录条目按 id join 得到（市场被移除时缺失，UI 走降级）。
  listing?: PluginStoreListing;
}

export interface MyCodePluginsOverviewData {
  marketplaces: MyCodeMarketplaceSummaryData[];
  availablePlugins: MyCodeAvailablePluginData[];
  installedPlugins: MyCodeInstalledPluginData[];
  restorableBuiltins: MyCodeAvailablePluginData[];
  diagnostics: PluginLoadOutcome["diagnostics"];
}

export interface MyCodeMarketplaceUpdateData {
  diagnostics: PluginLoadOutcome["diagnostics"];
  marketplaces: MyCodeMarketplaceSummaryData[];
}

export interface AddMyCodeMarketplaceOptions extends ResolveMyCodePluginsOptions {
  abortSignal?: AbortSignal;
  dryRun?: boolean;
  source: string;
  /** `marketplace add --sparse`：仅 git/github 源支持 sparse checkout 子目录。 */
  sparsePaths?: string[];
}

export interface RemoveMyCodeMarketplaceOptions extends ResolveMyCodePluginsOptions {
  marketplace: string;
}

export interface UpdateMyCodeMarketplaceOptions extends ResolveMyCodePluginsOptions {
  abortSignal?: AbortSignal;
  marketplace?: string;
}

export interface InstallMyCodeMarketplacePluginOptions extends ResolveMyCodePluginsOptions {
  abortSignal?: AbortSignal;
  dryRun?: boolean;
  marketplace: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface UninstallMyCodeMarketplacePluginOptions extends ResolveMyCodePluginsOptions {
  pluginId?: string;
  pluginName?: string;
  marketplace?: string;
  removeCache?: boolean;
  /** 保留 data/<plugin-id> 用户数据目录（`mycode plugins uninstall --keep-data`）。 */
  keepData?: boolean;
}

export interface UpdateMyCodeMarketplacePluginOptions extends ResolveMyCodePluginsOptions {
  abortSignal?: AbortSignal;
  pluginId: string;
}

export interface ValidateMyCodePluginPathOptions extends ResolveMyCodePluginsOptions {
  abortSignal?: AbortSignal;
  path: string;
}

export interface MyCodePluginUpdateData extends MyCodePluginInstallData {
  previousVersion: string;
}

export interface RestoreBuiltinPluginOptions extends ResolveMyCodePluginsOptions {
  pluginId: string;
}

export interface ConfigureMyCodePluginOptions extends ResolveMyCodePluginsOptions {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ResetMyCodePluginConfigOptions extends ResolveMyCodePluginsOptions {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ValidateMyCodePluginOptions extends ResolveMyCodePluginsOptions {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface DescribeMyCodePluginOptions extends ResolveMyCodePluginsOptions {
  marketplace: string;
  pluginName: string;
}

export interface MyCodePluginInstallData {
  dependencyClosure: string[];
  installedPlugins: MyCodeInstalledPluginData[];
  diagnostics: PluginLoadOutcome["diagnostics"];
}

/**
 * 市场插件计数只数用户可见条目。
 *
 * node-repl-host 是 Browser Use 与 Computer Use 共用的运行时宿主：它必须留在官方 manifest 里
 * （否则不会被发现、安装、启用），但没有 skill、没有 listing，也不该出现在设置页。计进去会让
 * 显示的插件数比它能列出的条目多一个。
 *
 * 判据故意是「官方市场里的这个具名条目」，而不是「没有 listing 的条目」—— 后者会误伤第三方
 * 市场：自定义 manifest 里的条目本来就可以不带 listing，它们是真实可见的插件。
 */
export function countVisibleMarketplacePlugins(
  marketplaceId: string,
  plugins: readonly { name: string }[] | undefined,
): number | undefined {
  if (!plugins) return undefined;
  if (marketplaceId !== MYCODE_OFFICIAL_PLUGIN_MARKETPLACE) return plugins.length;
  return plugins.filter((entry) => entry.name !== OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME).length;
}

export function resolveMyCodePlugins(options: ResolveMyCodePluginsOptions = {}): PluginLoadOutcome {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);

  return discoverNodePluginsSync({
    config: configResult.config.plugins,
    env: options.env ?? process.env,
    officialPluginRoots: resolveOfficialPluginRoots({
      extraRoots: options.officialPluginRoots,
      // cache 锁冲突已从 fatal 改为 degraded，普通插件入口也必须保留诊断日志。
      logger: options.logger,
      storageRoot: pluginStorageRoot,
      suppressedBuiltins: new Set(configResult.config.plugins.suppressedBuiltins),
    }),
    officialPluginsEnabledByDefault: DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
    storageRoot: pluginStorageRoot,
    workingDirectory,
  });
}

export function resolvePluginContext(options: ResolveMyCodePluginsOptions): {
  configResult: ConfigResult;
  pluginStorageRoot: string;
  workingDirectory: string;
} {
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
  const storageRoot = resolvePath(configResult.config.storage.dir);
  return {
    configResult,
    pluginStorageRoot:
      options.pluginStorageRoot ?? getPluginStorageRoot(getCliStorageRoot(storageRoot)),
    workingDirectory,
  };
}

export function resolveDeclaredMarketplaceSources(input: {
  configResult: ConfigResult;
}): Map<string, MarketplaceSource> {
  return new Map(
    Object.entries(input.configResult.config.plugins.extraKnownMarketplaces ?? {}).map(
      ([marketplaceId, declaration]) => {
        const baseDirectory = dirname(input.configResult.sources.plugins.paths.user);
        return [marketplaceId, resolveDeclaredMarketplaceSource(declaration.source, baseDirectory)];
      },
    ),
  );
}

export function resolveDeclaredMarketplaceSource(
  source: ConfigResult["config"]["plugins"]["extraKnownMarketplaces"][string]["source"],
  baseDirectory: string,
): MarketplaceSource {
  // User Marketplace 的相对路径按 User config 所在目录解析；配置读取不触碰 source，
  // 只有显式 refresh/install 才会真正读取、复制或联网。
  if (source.source === "file" || source.source === "directory") {
    return {
      ...source,
      path: isAbsolute(source.path) ? resolve(source.path) : resolve(baseDirectory, source.path),
    };
  }
  return source;
}

export function createDeclaredMarketplaceRecord(
  marketplaceId: string,
  source: MarketplaceSource,
): KnownMarketplaceRecord {
  return {
    id: marketplaceId,
    source,
    name: marketplaceId,
    addedAt: "",
    pluginCount: 0,
  };
}
