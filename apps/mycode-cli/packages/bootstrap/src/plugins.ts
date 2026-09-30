import { isDeepStrictEqual } from "node:util";
import {
  enablePluginsByDefaultInFileConfig,
  removeSuppressedBuiltinInFileConfig,
} from "@mycode/adapters/config";
import {
  ensureDefaultPluginMarketplaces,
  installMarketplacePlugin,
  listInstalledPluginRecords,
  loadKnownMarketplacesSync,
  loadMarketplaceManifestSync,
  validateMarketplacePlugin,
  validateMarketplaceSource,
} from "@mycode/adapters/plugins";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@mycode/contracts";
import {
  type InstallMyCodeMarketplacePluginOptions,
  type MyCodePluginInstallData,
  resolvePluginContext,
  resolveDeclaredMarketplaceSources,
  resolveMyCodePlugins,
  type UpdateMyCodeMarketplacePluginOptions,
  type MyCodePluginUpdateData,
} from "./plugins-resolve-my-code-plugins-options.js";
import {
  createMarketplaceSourceRepointDiagnostic,
  toPluginDiagnostic,
  restoreBuiltinPluginCore,
  materializeDeclaredMarketplaceForExplicitAction,
  updateMyCodePluginMarketplace,
} from "./plugins-add-my-code-plugin-marketplace.js";
import { toInstalledPluginData } from "./plugins-resolve-effective-marketplace-records.js";
import { toMarketplaceInstallDiagnostic } from "./plugins-uninstall-my-code-marketplace-plugin.js";

export async function installMyCodeMarketplacePlugin(
  options: InstallMyCodeMarketplacePluginOptions,
): Promise<MyCodePluginInstallData> {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  ensureDefaultPluginMarketplaces(pluginStorageRoot);
  if (options.dryRun === true) {
    const declarationSource = resolveDeclaredMarketplaceSources({
      configResult,
    }).get(options.marketplace);
    const known = loadKnownMarketplacesSync(pluginStorageRoot).find(
      (record) => record.id === options.marketplace,
    );
    if (declarationSource && known && !isDeepStrictEqual(known.source, declarationSource)) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: [createMarketplaceSourceRepointDiagnostic(options.marketplace)],
      };
    }
    if (
      declarationSource &&
      (!known || !loadMarketplaceManifestSync(pluginStorageRoot, options.marketplace))
    ) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: (
          await validateMarketplaceSource({
            expectedId: options.marketplace,
            pluginName: options.pluginName,
            signal: options.abortSignal,
            source: declarationSource,
            storageRoot: pluginStorageRoot,
          })
        ).map(toPluginDiagnostic),
      };
    }
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: (
        await validateMarketplacePlugin({
          marketplace: options.marketplace,
          name: options.pluginName,
          storageRoot: pluginStorageRoot,
        })
      ).map(toPluginDiagnostic),
    };
  }
  const pluginId = `${options.pluginName}@${options.marketplace}`;
  const bundledEntry = loadMarketplaceManifestSync(
    pluginStorageRoot,
    options.marketplace,
  )?.plugins.find((entry) => entry.name === options.pluginName);
  const isSuppressedBundledOfficial =
    options.marketplace === MYCODE_OFFICIAL_PLUGIN_MARKETPLACE &&
    configResult.config.plugins.suppressedBuiltins.includes(pluginId) &&
    (bundledEntry?.source === "filesystem" || bundledEntry?.source === "sea");
  if (isSuppressedBundledOfficial) {
    // 内置插件的 filesystem/SEA entry 只是 Catalog 指针，不是普通 Marketplace source。
    // 直接安装必须复用 restore，避免把同一份官方 cache 写进 installed_plugins.json，
    // 否则卸载/更新会把内置资产误判成用户安装并破坏恢复语义。
    // 当前调用由协议层的 storage lock 保护；这里必须调用不再加锁的核心，
    // 否则同一 storageRoot 的 promise-chain lock 会等待自身而永久阻塞。
    await restoreBuiltinPluginCore({ ...options, configResult, pluginId });
    const fresh = resolvePluginContext({ ...options, configResult: undefined });
    const outcome = resolveMyCodePlugins({
      ...options,
      configResult: fresh.configResult,
      pluginStorageRoot: fresh.pluginStorageRoot,
    });
    const restored = outcome.plugins.find((plugin) => plugin.id === pluginId);
    if (!restored) {
      return {
        dependencyClosure: [],
        installedPlugins: [],
        diagnostics: [
          toPluginDiagnostic({
            code: "plugin_not_found",
            message: `Bundled plugin could not be restored: ${pluginId}`,
            pluginId,
            severity: "error",
          }),
        ],
      };
    }
    const now = new Date().toISOString();
    return {
      dependencyClosure: [pluginId],
      installedPlugins: [
        toInstalledPluginData(
          {
            id: restored.id,
            name: restored.name,
            marketplace: restored.marketplace,
            version: restored.version ?? "",
            installPath: restored.rootPath,
            installedAt: now,
            updatedAt: now,
            scope: "user",
          },
          restored.enabled,
          restored,
        ),
      ],
      diagnostics: [],
    };
  }
  let installed: Awaited<ReturnType<typeof installMarketplacePlugin>>;
  try {
    await materializeDeclaredMarketplaceForExplicitAction({
      configResult,
      marketplaceId: options.marketplace,
      pluginStorageRoot,
      abortSignal: options.abortSignal,
      workingDirectory,
    });
    installed = await installMarketplacePlugin({
      signal: options.abortSignal,
      marketplace: options.marketplace,
      name: options.pluginName,
      // package/cache/installed record 是目标 Host 的 User inventory；
      // 旧协议的 Workspace scope 仅为兼容保留，不能改变 Marketplace 默认启用写入 User config
      // 的语义。installed record 没有 workspace identity，不能让它参与 Workspace 配置归属。
      scope: "user",
      storageRoot: pluginStorageRoot,
    });
  } catch (error) {
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: [
        toMarketplaceInstallDiagnostic(error, `${options.pluginName}@${options.marketplace}`),
      ],
    };
  }
  if (options.marketplace === MYCODE_OFFICIAL_PLUGIN_MARKETPLACE) {
    // 官方 marketplace 复用内置插件的 id 空间。若同名 CDN 插件重新安装，
    // 清掉历史内置 suppression，否则 Runtime 仍会把已拥有的安装误判为 suppressed。
    for (const record of installed.installed) {
      await removeSuppressedBuiltinInFileConfig(configResult.sources.user.path, record.id);
    }
  }
  // Marketplace 只管理 Host User inventory；即使旧协议调用方传入 workspace scope，
  // 安装即默认启用也必须写入 User config，不能把 Marketplace 动作变成 Workspace override。
  // 仅作用于用户配置里尚未显式声明的 id（停用后重装等显式选择不被覆盖）。
  const { enabledIds } = await enablePluginsByDefaultInFileConfig(
    configResult.sources.user.path,
    installed.installed.map((record) => record.id),
  );
  const enabledIdSet = new Set(enabledIds);
  // 已有显式配置的，沿用其当前启用态；本次新置默认启用的标记为 true。
  const enabledById = (id: string): boolean =>
    enabledIdSet.has(id) || (configResult.config.plugins.enabledPlugins[id] ?? false);
  return {
    dependencyClosure: installed.closure,
    installedPlugins: installed.installed.map((record) =>
      toInstalledPluginData(record, enabledById(record.id)),
    ),
    diagnostics: [],
  };
}

/**
 * `mycode plugins update <plugin>`：先刷新所属 marketplace 目录，再按同一条目重装。
 * cacheMarketplacePlugin 对已存在的安装记录做原地覆盖并保留 installedAt；启用态只会给
 * 用户配置里尚未显式声明的 id 补默认值，因此更新不会改变用户已经做过的开关选择。
 */
export async function updateMyCodeMarketplacePlugin(
  options: UpdateMyCodeMarketplacePluginOptions,
): Promise<MyCodePluginUpdateData> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  const record = listInstalledPluginRecords(pluginStorageRoot).find(
    (installed) => installed.id === options.pluginId,
  );
  if (!record) throw new Error(`Plugin not installed: ${options.pluginId}`);
  const refreshed = await updateMyCodePluginMarketplace({
    ...options,
    marketplace: record.marketplace,
  });
  const refreshErrors = refreshed.diagnostics.filter((item) => item.severity === "error");
  if (refreshErrors.length > 0) {
    return {
      dependencyClosure: [],
      installedPlugins: [],
      diagnostics: refreshErrors,
      previousVersion: record.version,
    };
  }
  const installed = await installMyCodeMarketplacePlugin({
    ...options,
    marketplace: record.marketplace,
    pluginName: record.name,
    scope: record.scope,
  });
  return { ...installed, previousVersion: record.version };
}

export type { ResolveMyCodePluginsOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { ListMyCodePluginsOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { SetMyCodePluginEnabledOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { SetMyCodePluginEnabledResult } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodeMarketplaceSummaryData } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodeAvailablePluginData } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodeInstalledPluginData } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodePluginsOverviewData } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodeMarketplaceUpdateData } from "./plugins-resolve-my-code-plugins-options.js";
export type { AddMyCodeMarketplaceOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { RemoveMyCodeMarketplaceOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { UpdateMyCodeMarketplaceOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { InstallMyCodeMarketplacePluginOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { UninstallMyCodeMarketplacePluginOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { UpdateMyCodeMarketplacePluginOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { ValidateMyCodePluginPathOptions } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodePluginUpdateData } from "./plugins-resolve-my-code-plugins-options.js";
export type { MyCodePluginInstallData } from "./plugins-resolve-my-code-plugins-options.js";
export { resolveMyCodePlugins } from "./plugins-resolve-my-code-plugins-options.js";
export { getMyCodePluginsOverview } from "./plugins-get-my-code-plugins-overview.js";
export { listMyCodePlugins } from "./plugins-get-my-code-plugins-overview.js";
export { setMyCodePluginEnabled } from "./plugins-get-my-code-plugins-overview.js";
export { addMyCodePluginMarketplace } from "./plugins-add-my-code-plugin-marketplace.js";
export { removeMyCodePluginMarketplace } from "./plugins-add-my-code-plugin-marketplace.js";
export { updateMyCodePluginMarketplace } from "./plugins-add-my-code-plugin-marketplace.js";
export { uninstallMyCodeMarketplacePlugin } from "./plugins-uninstall-my-code-marketplace-plugin.js";
export { validateMyCodePluginPath } from "./plugins-uninstall-my-code-marketplace-plugin.js";
export { restoreBuiltinPlugin } from "./plugins-uninstall-my-code-marketplace-plugin.js";
export { configureMyCodePlugin } from "./plugins-uninstall-my-code-marketplace-plugin.js";
export { resetMyCodePluginConfig } from "./plugins-uninstall-my-code-marketplace-plugin.js";
export { validateMyCodePlugin } from "./plugins-validate-my-code-plugin.js";
export { describeMyCodePlugin } from "./plugins-validate-my-code-plugin.js";
