import {
  mycodePluginsListParamsSchema,
  mycodePluginsSetEnabledParamsSchema,
  type MyCodePluginInfo,
  type MyCodePluginsListResult,
  type MyCodePluginsSetEnabledResult,
} from "@mycode/shared";
import type { PluginMetadata } from "@mycode/contracts";
import { resolveMyCodePlugins, setMyCodePluginEnabled } from "../plugins.js";
import { resolveOfficialPluginHostMcpServerNames } from "../app/official-plugin-definitions.js";
import { type ConfigResult } from "@mycode/adapters/config";
import { parseParams, type MyCodeProtocolAgentServerContext } from "./server-types.js";
import {
  resolveInlinePluginRootSource,
  createPluginConfigView,
  createMissingConfiguredPluginInfos,
  toPluginDiagnostic,
} from "./plugins-get-plugins-overview.js";

// 把 CLI 的 PluginMetadata 投影成协议可序列化的 MyCodePluginInfo (只保留 UI 需要的字段)。
function toPluginInfo(plugin: PluginMetadata, configResult?: ConfigResult): MyCodePluginInfo {
  const hostMcpServerNames = resolveOfficialPluginHostMcpServerNames(plugin.id);
  const configuredOptions = Object.fromEntries(
    Object.entries(plugin.configuredOptions ?? {}).filter(
      ([key]) => plugin.userConfig?.[key]?.sensitive !== true,
    ),
  );
  const enabledSource = configResult?.sources.plugins.enabled[plugin.id];
  const optionSources = configResult?.sources.plugins.options[plugin.id];
  const rootSource =
    plugin.source === "inline" && configResult
      ? resolveInlinePluginRootSource(plugin.rootPath, configResult)
      : undefined;
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.description !== undefined ? { description: plugin.description } : {}),
    ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    source: plugin.source,
    marketplace: plugin.marketplace,
    // manifest 的作者/主页回退字段（商店 listing 优先）。
    ...(plugin.author !== undefined ? { author: plugin.author } : {}),
    ...(plugin.authorUrl !== undefined ? { authorUrl: plugin.authorUrl } : {}),
    ...(plugin.homepage !== undefined ? { homepage: plugin.homepage } : {}),
    skillCount: plugin.skillCount,
    skillRootCount: plugin.skillRootCount,
    commandRootCount: plugin.commandRootCount,
    // 权威组件清单随 list 下发，名称+描述由 loader 枚举（与启用态无关），供详情 UI 直接展示。
    components: plugin.components.map((group) => ({
      kind: group.kind,
      items: group.items.map((item) => ({
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
      })),
    })),
    declaredMcpServerNames: plugin.declaredMcpServerNames,
    mcpServerNames: plugin.mcpServerNames,
    ...(hostMcpServerNames.length > 0 ? { hostMcpServerNames } : {}),
    hookDetails: plugin.hookDetails,
    rootPath: plugin.rootPath,
    ...(plugin.userConfig ? { userConfig: plugin.userConfig } : {}),
    ...(Object.keys(configuredOptions).length > 0 ? { configuredOptions } : {}),
    ...(rootSource ? { rootSource } : {}),
    ...(enabledSource ? { enabledSource } : {}),
    ...(optionSources && Object.keys(optionSources).length > 0 ? { optionSources } : {}),
  };
}

export async function listPlugins(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<MyCodePluginsListResult> {
  const params = parseParams(mycodePluginsListParamsSchema, rawParams);
  const configResult = createPluginConfigView(
    context,
    params.workspace.workspacePath,
    params.configScope,
  );
  const outcome = resolveMyCodePlugins({
    configResult,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  const plugins = outcome.plugins.map((plugin) => toPluginInfo(plugin, configResult));
  return {
    plugins: [
      ...plugins,
      ...createMissingConfiguredPluginInfos(
        configResult,
        new Set(plugins.map((plugin) => plugin.id)),
      ),
    ],
    diagnostics: outcome.diagnostics.map(toPluginDiagnostic),
  };
}

export async function setPluginEnabled(
  context: MyCodeProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
): Promise<MyCodePluginsSetEnabledResult> {
  const params = parseParams(mycodePluginsSetEnabledParamsSchema, rawParams);
  abortSignal?.throwIfAborted();
  const result = await setMyCodePluginEnabled({
    enabled: params.enabled,
    logger: context.logger,
    plugin: params.pluginId,
    scope: params.scope,
    workingDirectory: params.workspace.workspacePath,
  });
  // 启用配置写入当前不可回滚；若取消在 IO 期间到达，只阻断后续响应和 UI 写入。
  abortSignal?.throwIfAborted();
  return {
    plugin: {
      ...toPluginInfo(result.plugin),
      enabledSource: params.scope ?? "user",
    },
    enabled: result.enabled,
  };
}

export { getPluginsOverview } from "./plugins-get-plugins-overview.js";
export { addPluginMarketplace } from "./plugins-get-plugins-overview.js";
export { removePluginMarketplace } from "./plugins-get-plugins-overview.js";
export { updatePluginMarketplace } from "./plugins-update-plugin-marketplace.js";
export { installPlugin } from "./plugins-update-plugin-marketplace.js";
export { uninstallPlugin } from "./plugins-update-plugin-marketplace.js";
export { updatePlugin } from "./plugins-update-plugin-marketplace.js";
export { restoreBuiltinPlugin } from "./plugins-update-plugin-marketplace.js";
export { configurePlugin } from "./plugins-update-plugin-marketplace.js";
export { resetPluginConfig } from "./plugins-update-plugin-marketplace.js";
export { validatePlugin } from "./plugins-update-plugin-marketplace.js";
export { describePlugin } from "./plugins-update-plugin-marketplace.js";
