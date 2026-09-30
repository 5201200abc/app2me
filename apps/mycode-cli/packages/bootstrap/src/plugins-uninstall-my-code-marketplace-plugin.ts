import { rm } from "node:fs/promises";
import {
  addSuppressedBuiltinInFileConfig,
  removePluginEnabledFromFileConfig,
  removePluginFromFileConfig,
  removeSuppressedBuiltinInFileConfig,
  updatePluginOptionsInFileConfig,
} from "@mycode/adapters/config";
import {
  getPluginSourceDiagnosticCode,
  getPluginDataDir,
  listInstalledPluginRecords,
  uninstallMarketplacePlugin,
  validateLocalPluginPath,
} from "@mycode/adapters/plugins";
import type { PluginLoadOutcome } from "@mycode/contracts";
import { withPluginStorageLock } from "./lib/plugin-storage-lock.js";
import {
  type UninstallMyCodeMarketplacePluginOptions,
  type MyCodeInstalledPluginData,
  resolvePluginContext,
  resolveMyCodePlugins,
  type ValidateMyCodePluginPathOptions,
  type RestoreBuiltinPluginOptions,
  type ConfigureMyCodePluginOptions,
  type ResetMyCodePluginConfigOptions,
} from "./plugins-resolve-my-code-plugins-options.js";
import { toInstalledPluginData } from "./plugins-resolve-effective-marketplace-records.js";
import {
  toPluginDiagnostic,
  restoreBuiltinPluginCore,
  MarketplaceSourceRepointError,
} from "./plugins-add-my-code-plugin-marketplace.js";
import {
  resolvePluginSelector,
  resolvePluginConfigPath,
} from "./plugins-get-my-code-plugins-overview.js";

export async function uninstallMyCodeMarketplacePlugin(
  options: UninstallMyCodeMarketplacePluginOptions,
): Promise<MyCodeInstalledPluginData | null> {
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  return withPluginStorageLock(pluginStorageRoot, async () => {
    const pluginId = resolvePluginIdForMutation(options);

    // 官方 CDN marketplace 与内置插件共享 mycode-plugins-official id 空间，且其缓存
    // 也位于 official cache 下。若先看 runtime source="official"，会把已有
    // installed_plugins.json 记录的 CDN 插件误判成内置插件，只写 suppression 却不删安装记录，
    // 导致 UI 永远保持 installed、无法重装。持久化安装记录是 marketplace 所有权的权威证据，
    // 必须优先于运行时来源分类；同时清掉可能遗留的错误 suppression，让状态自愈。
    const installedRecord = listInstalledPluginRecords(pluginStorageRoot).find(
      (record) => record.id === pluginId,
    );
    if (installedRecord) {
      const removed = await uninstallMarketplacePlugin({
        pluginId,
        // 卸载语义即彻底清除：除非调用方显式传 removeCache=false，否则连缓存与 data 目录一起删。
        removeCache: options.removeCache ?? true,
        keepData: options.keepData,
        storageRoot: pluginStorageRoot,
      });
      if (!removed) return null;
      await removePluginFromFileConfig(configResult.sources.user.path, removed.id);
      await removeSuppressedBuiltinInFileConfig(configResult.sources.user.path, removed.id);
      return toInstalledPluginData(removed, false);
    }

    // 内置（官方）插件不在 installed_plugins.json 里，无法走 marketplace 卸载路径。
    // 卸载只改变 Runtime 抑制态并清理用户数据/config；Catalog 与不可变 cache 必须保留，
    // 这样详情页仍能离线读取组件，且恢复动作不依赖重新下载或重新构造目录。
    const outcome = resolveMyCodePlugins({
      ...options,
      configResult,
      pluginStorageRoot,
      workingDirectory,
    });
    const builtin = outcome.plugins.find(
      (plugin) => plugin.id === pluginId && plugin.source === "official",
    );
    if (builtin) {
      await addSuppressedBuiltinInFileConfig(configResult.sources.user.path, pluginId);
      // 先清掉 user config 里的 enabledPlugins[id] 与 options[id]，再删目录：抑制标记已是
      // 唯一真相源（写入用原子 temp+rename），即使后续删除抛错，下次 resolve 也会跳过并补删
      // 缓存；把 config 清理放在删除之前可保证「恢复时从干净状态开始」即便删除中途失败。
      await removePluginFromFileConfig(configResult.sources.user.path, pluginId);
      // 不删除官方 cache：它与 Marketplace Catalog 同属详情/恢复所需的只读资产。
      if (options.keepData !== true) {
        await rm(getPluginDataDir(pluginStorageRoot, pluginId), { force: true, recursive: true });
      }
      const now = new Date().toISOString();
      return toInstalledPluginData(
        {
          id: builtin.id,
          name: builtin.name,
          marketplace: builtin.marketplace,
          version: builtin.version ?? "",
          installPath: builtin.rootPath,
          installedAt: now,
          updatedAt: now,
          scope: "user",
        },
        false,
      );
    }

    return null;
  });
}

/** `mycode plugins validate <path>`：只读校验本地插件目录或 marketplace 目录。 */
export async function validateMyCodePluginPath(
  options: ValidateMyCodePluginPathOptions,
): Promise<PluginLoadOutcome["diagnostics"]> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  return (
    await validateLocalPluginPath({
      path: options.path,
      signal: options.abortSignal,
      storageRoot: pluginStorageRoot,
    })
  ).map(toPluginDiagnostic);
}

export async function restoreBuiltinPlugin(options: RestoreBuiltinPluginOptions): Promise<void> {
  const { pluginStorageRoot } = resolvePluginContext(options);
  await withPluginStorageLock(pluginStorageRoot, () => restoreBuiltinPluginCore(options));
}

export async function configureMyCodePlugin(options: ConfigureMyCodePluginOptions): Promise<void> {
  const normalizedOptions = normalizePluginOptions(options.options);
  const clearOptionKeys = normalizePluginOptionKeys(options.clearOptionKeys);
  const { configResult, pluginStorageRoot, workingDirectory } = resolvePluginContext(options);
  const outcome = resolveMyCodePlugins({
    ...options,
    configResult,
    pluginStorageRoot,
    workingDirectory,
  });
  const plugin = resolvePluginSelector(options.pluginId, outcome.plugins);
  if (options.dryRun === true) return;
  await updatePluginOptionsInFileConfig(
    resolvePluginConfigPath(options, configResult, workingDirectory),
    plugin.id,
    normalizedOptions,
    clearOptionKeys,
  );
}

/** 删除指定 scope 的 Plugin 配置键，使 Workspace scope 回退到 User。 */
export async function resetMyCodePluginConfig(
  options: ResetMyCodePluginConfigOptions,
): Promise<{ path: string; pluginId: string }> {
  const { configResult, workingDirectory } = resolvePluginContext(options);
  const path = resolvePluginConfigPath(options, configResult, workingDirectory);
  if (options.scope === "workspace") {
    // “恢复继承”只删除 Workspace 的 enable override。options 是独立配置维度，
    // 不能因为用户恢复开关继承而把 Workspace options/secret 一并抹掉。
    await removePluginEnabledFromFileConfig(path, options.pluginId);
  } else {
    await removePluginFromFileConfig(path, options.pluginId);
  }
  return { path, pluginId: options.pluginId };
}

export function resolvePluginIdForMutation(
  options: UninstallMyCodeMarketplacePluginOptions,
): string {
  if (options.pluginId) return options.pluginId;
  if (options.pluginName && options.marketplace) {
    return `${options.pluginName}@${options.marketplace}`;
  }
  throw new Error("pluginId or pluginName + marketplace is required");
}

export function normalizePluginOptions(
  options: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

export function normalizePluginOptionKeys(keys: string[] | undefined): string[] {
  return [...new Set((keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))];
}

export function toMarketplaceInstallDiagnostic(
  error: unknown,
  pluginId: string,
): PluginLoadOutcome["diagnostics"][number] {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof MarketplaceSourceRepointError) {
    return toPluginDiagnostic({
      code: "plugin_marketplace_invalid",
      message,
      pluginId,
      severity: "error",
    });
  }
  const sourceCode = getPluginSourceDiagnosticCode(error);
  if (sourceCode) {
    return toPluginDiagnostic({
      code: sourceCode,
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.startsWith("Plugin not found:")) {
    return toPluginDiagnostic({
      code: "plugin_not_found",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("Cross-marketplace dependency")) {
    return toPluginDiagnostic({
      code: "plugin_dependency_cross_marketplace",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("dependency cycle")) {
    return toPluginDiagnostic({
      code: "plugin_dependency_cycle",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (
    message.includes("Dependency not found") ||
    message.includes("Marketplace not found for dependency")
  ) {
    return toPluginDiagnostic({
      code: "plugin_dependency_missing",
      message,
      pluginId,
      severity: "error",
    });
  }
  if (message.includes("source is recognized but not supported")) {
    return toPluginDiagnostic({
      code: "plugin_marketplace_source_unsupported",
      message,
      pluginId,
      severity: "error",
    });
  }
  return toPluginDiagnostic({
    code: "plugin_marketplace_invalid",
    message,
    pluginId,
    severity: "error",
  });
}
