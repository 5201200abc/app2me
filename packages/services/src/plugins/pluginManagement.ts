// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IMyCodeAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 mycode-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@mycode/rpc";
import type {
  MyCodePluginOperationProgressNotification,
  MyCodePluginsConfigureResult,
  MyCodePluginsCancelOperationResult,
  MyCodePluginsDescribeResult,
  MyCodePluginsInstallResult,
  MyCodePluginsListResult,
  MyCodePluginsMarketplaceMutationResult,
  MyCodePluginsOverviewResult,
  MyCodePluginsReferenceCatalogResult,
  MyCodePluginsRestoreBuiltinResult,
  MyCodePluginsSetEnabledResult,
  MyCodePluginsUninstallResult,
  MyCodePluginsValidateResult,
} from "@mycode/shared";
import { ServiceChannels } from "@mycode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  MyCodeAgentAddPluginMarketplaceParams,
  MyCodeAgentConfigurePluginParams,
  MyCodeAgentCancelPluginOperationParams,
  MyCodeAgentDescribePluginParams,
  MyCodeAgentInstallPluginParams,
  MyCodeAgentPluginReferenceCatalogParams,
  MyCodeAgentResolveSuggestedPluginReferenceParams,
  MyCodeAgentResetPluginConfigParams,
  MyCodeAgentPluginViewParams,
  MyCodeAgentRemovePluginMarketplaceParams,
  MyCodeAgentRestoreBuiltinPluginParams,
  MyCodeAgentSetPluginEnabledParams,
  MyCodeAgentUninstallPluginParams,
  MyCodeAgentUpdatePluginMarketplaceParams,
  MyCodeAgentUpdatePluginParams,
  MyCodeAgentValidatePluginParams,
} from "../mycode-agent/mycodeAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: MyCodeAgentPluginViewParams): Promise<MyCodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: MyCodeAgentPluginReferenceCatalogParams,
  ): Promise<MyCodePluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: MyCodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@mycode/shared").MyCodePluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<MyCodePluginOperationProgressNotification>;
  getPluginsOverview(params: MyCodeAgentPluginViewParams): Promise<MyCodePluginsOverviewResult>;
  addPluginMarketplace(
    params: MyCodeAgentAddPluginMarketplaceParams,
  ): Promise<MyCodePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: MyCodeAgentRemovePluginMarketplaceParams,
  ): Promise<MyCodePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: MyCodeAgentUpdatePluginMarketplaceParams,
  ): Promise<MyCodePluginsMarketplaceMutationResult>;
  installPlugin(params: MyCodeAgentInstallPluginParams): Promise<MyCodePluginsInstallResult>;
  cancelPluginOperation(
    params: MyCodeAgentCancelPluginOperationParams,
  ): Promise<MyCodePluginsCancelOperationResult>;
  uninstallPlugin(params: MyCodeAgentUninstallPluginParams): Promise<MyCodePluginsUninstallResult>;
  updatePlugin(params: MyCodeAgentUpdatePluginParams): Promise<MyCodePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: MyCodeAgentRestoreBuiltinPluginParams,
  ): Promise<MyCodePluginsRestoreBuiltinResult>;
  configurePlugin(params: MyCodeAgentConfigurePluginParams): Promise<MyCodePluginsConfigureResult>;
  resetPluginConfig(
    params: MyCodeAgentResetPluginConfigParams,
  ): Promise<MyCodePluginsConfigureResult>;
  validatePlugin(params: MyCodeAgentValidatePluginParams): Promise<MyCodePluginsValidateResult>;
  describePlugin(params: MyCodeAgentDescribePluginParams): Promise<MyCodePluginsDescribeResult>;
  setPluginEnabled(params: MyCodeAgentSetPluginEnabledParams): Promise<MyCodePluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
