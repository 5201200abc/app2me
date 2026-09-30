import {
  mycodePluginsConfigureParamsSchema,
  mycodePluginsResetConfigParamsSchema,
  mycodePluginsInstallParamsSchema,
  mycodePluginsMarketplaceUpdateParamsSchema,
  mycodePluginsUninstallParamsSchema,
  mycodePluginsUpdateParamsSchema,
  mycodePluginsValidateParamsSchema,
  mycodePluginsDescribeParamsSchema,
  mycodePluginsRestoreBuiltinParamsSchema,
  type MyCodeInstalledPluginSummary,
  type MyCodePluginComponentGroup,
  type MyCodePluginDiagnostic,
  type MyCodePluginsConfigureResult,
  type MyCodePluginsDescribeResult,
  type MyCodePluginsInstallResult,
  type MyCodePluginsMarketplaceMutationResult,
  type MyCodePluginsRestoreBuiltinResult,
  type MyCodePluginsUninstallResult,
  type MyCodePluginsValidateResult,
} from "@mycode/shared";
import {
  configureMyCodePlugin,
  describeMyCodePlugin,
  installMyCodeMarketplacePlugin,
  resetMyCodePluginConfig,
  restoreBuiltinPlugin as restoreBuiltinPluginCore,
  uninstallMyCodeMarketplacePlugin,
  updateMyCodePluginMarketplace,
  validateMyCodePlugin,
} from "../plugins.js";
import { listInstalledPluginRecords } from "@mycode/adapters/plugins";
import { withPluginStorageLock } from "../lib/plugin-storage-lock.js";
import { parseParams, type MyCodeProtocolAgentServerContext } from "./server-types.js";
import {
  resolvePluginStorageRoot,
  toMarketplaceSummary,
  toPluginDiagnostic,
  toInstalledPluginSummary,
} from "./plugins-get-plugins-overview.js";

export async function updatePluginMarketplace(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<MyCodePluginsMarketplaceMutationResult> {
  const params = parseParams(mycodePluginsMarketplaceUpdateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await withPluginStorageLock(pluginStorageRoot, async () =>
    updateMyCodePluginMarketplace({
      abortSignal,
      logger: context.logger,
      marketplace: params.marketplace,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    marketplaces: result.marketplaces.map(toMarketplaceSummary),
    diagnostics: result.diagnostics.map(toPluginDiagnostic),
  };
}

export async function installPlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<MyCodePluginsInstallResult> {
  const params = parseParams(mycodePluginsInstallParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await withPluginStorageLock(pluginStorageRoot, async () =>
    installMyCodeMarketplacePlugin({
      abortSignal,
      dryRun: params.dryRun,
      logger: context.logger,
      marketplace: params.marketplace,
      pluginName: params.pluginName,
      scope: params.scope,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    dependencyClosure: result.dependencyClosure,
    installedPlugins: result.installedPlugins.map(toInstalledPluginSummary),
    diagnostics: result.diagnostics.map(toPluginDiagnostic),
  };
}

export async function uninstallPlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsUninstallResult> {
  const params = parseParams(mycodePluginsUninstallParamsSchema, rawParams);
  const removed = await uninstallMyCodeMarketplacePlugin({
    logger: context.logger,
    marketplace: params.marketplace,
    pluginId: params.pluginId,
    pluginName: params.pluginName,
    removeCache: params.removeCache,
    workingDirectory: params.workspace.workspacePath,
  });
  return {
    ...(removed ? { removedPlugin: toInstalledPluginSummary(removed) } : {}),
    diagnostics: [],
  };
}

export async function updatePlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsInstallResult> {
  const params = parseParams(mycodePluginsUpdateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const installed = listInstalledPluginRecords(pluginStorageRoot).filter((record) => {
    if (params.pluginId) return record.id === params.pluginId;
    if (params.marketplace) return record.marketplace === params.marketplace;
    return true;
  });
  // 与 uninstall 一样把整个重装循环串行化到同一 storageRoot 的 in-process 锁里，
  // 避免并发 update/install 交错读改写 installed_plugins.json / cache。
  return withPluginStorageLock(pluginStorageRoot, async () => {
    const installedPlugins: MyCodeInstalledPluginSummary[] = [];
    const dependencyClosure: string[] = [];
    // 聚合每条记录重装产生的诊断：installMyCodeMarketplacePlugin 失败时不抛错，而是返回
    // CLI 形态的 PluginDiagnostic（见其错误分支的 toMarketplaceInstallDiagnostic），
    // 这里逐条经协议侧 toPluginDiagnostic 投影成 MyCodePluginDiagnostic 回传，
    // 让失败的重装显式暴露，而不是静默"成功"。
    const diagnostics: MyCodePluginDiagnostic[] = [];
    for (const record of installed) {
      const result = await installMyCodeMarketplacePlugin({
        logger: context.logger,
        marketplace: record.marketplace,
        pluginName: record.name,
        scope: record.scope,
        workingDirectory: params.workspace.workspacePath,
      });
      installedPlugins.push(...result.installedPlugins.map(toInstalledPluginSummary));
      dependencyClosure.push(...result.dependencyClosure);
      diagnostics.push(...result.diagnostics.map(toPluginDiagnostic));
    }
    return { dependencyClosure, installedPlugins, diagnostics };
  });
}

// 恢复一个被抑制（"卸载"）的内置插件：清除 suppressedBuiltins 标记并立即重新 seed。
// bootstrap 侧的同名函数被别名为 restoreBuiltinPluginCore，避免与本协议处理器重名。
export async function restoreBuiltinPlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsRestoreBuiltinResult> {
  const params = parseParams(mycodePluginsRestoreBuiltinParamsSchema, rawParams);
  await restoreBuiltinPluginCore({
    logger: context.logger,
    pluginId: params.pluginId,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function configurePlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsConfigureResult> {
  const params = parseParams(mycodePluginsConfigureParamsSchema, rawParams);
  await configureMyCodePlugin({
    clearOptionKeys: params.clearOptionKeys,
    dryRun: params.dryRun,
    logger: context.logger,
    options: params.options,
    pluginId: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function resetPluginConfig(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsConfigureResult> {
  const params = parseParams(mycodePluginsResetConfigParamsSchema, rawParams);
  await resetMyCodePluginConfig({
    logger: context.logger,
    pluginId: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  return { pluginId: params.pluginId, diagnostics: [] };
}

export async function validatePlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsValidateResult> {
  const params = parseParams(mycodePluginsValidateParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const diagnostics = await withPluginStorageLock(pluginStorageRoot, async () =>
    validateMyCodePlugin({
      logger: context.logger,
      marketplace: params.marketplace,
      pluginName: params.pluginName,
      source: params.source,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics: diagnostics.map(toPluginDiagnostic),
    compatibility: {
      runnable: ["skills", "commands", "hooks", "mcpServers", "userConfig"],
      diagnosticOnly: ["agents", "lspServers", "outputStyles", "channels", "settings"],
      unsupported: ["mcpb", "dxt", "npm", "hostPattern", "pathPattern"],
    },
  };
}

export async function describePlugin(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsDescribeResult> {
  const params = parseParams(mycodePluginsDescribeParamsSchema, rawParams);
  const pluginStorageRoot = resolvePluginStorageRoot(params.workspace.workspacePath);
  const result = await withPluginStorageLock(pluginStorageRoot, async () =>
    describeMyCodePlugin({
      logger: context.logger,
      marketplace: params.marketplace,
      pluginName: params.pluginName,
      workingDirectory: params.workspace.workspacePath,
    }),
  );
  const components: MyCodePluginComponentGroup[] = result.components.map((group) => ({
    kind: group.kind,
    items: group.items.map((item) => ({
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
    })),
  }));
  const diagnostics = result.diagnostics.map(toPluginDiagnostic);
  return {
    components,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(result.metadata ? { metadata: result.metadata } : {}),
  };
}
