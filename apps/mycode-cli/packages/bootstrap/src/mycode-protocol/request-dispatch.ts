import { querySessionDebug } from "./session-debug.js";
import { mycodeProtocolMethods, mycodeWorkspaceHookTrustGrantParamsSchema } from "@mycode/shared";

import {
  V4_METHODS,
  V4_NOTIFICATIONS,
  parseSessionsIndexTopic,
  parseWorkspaceConfigTopic,
} from "@mycode/shared/mycode-protocol-v4";
import type { MyCodeProtocolRequest, MyCodeProtocolRequestId } from "@mycode/shared";
import {
  cancelBackgroundTask,
  closeSession,
  compactSession,
  createSession,
  forkSession,
  generateWorkspaceText,
  goalSession,
  getTaskTokenUsage,
  getUsageStats,
  listSessions,
  listSessionSubagents,
  readEvents,
  readMessages,
  readSession,
  resumeSession,
  sendPrompt,
  setMode,
  setModel,
  setThoughtLevel,
  stopSession,
  subscribeSession,
} from "./server-operations.js";
import { listChildProcesses } from "./process-child-processes.js";

import {
  readWorkspacePresentation,
  testProviderModelConnectivity,
} from "./workspace-model-runtime.js";
import {
  addPluginMarketplace,
  configurePlugin,
  describePlugin,
  getPluginsOverview,
  installPlugin,
  listPlugins,
  removePluginMarketplace,
  resetPluginConfig,
  restoreBuiltinPlugin,
  setPluginEnabled,
  uninstallPlugin,
  updatePlugin,
  updatePluginMarketplace,
  validatePlugin,
} from "./plugins.js";
import {
  getPluginReferenceCatalog,
  resolveSuggestedPluginReference,
} from "./plugin-reference-catalog.js";
import { getSkillReferenceCatalog } from "./skill-reference-catalog.js";
import {
  deleteSavedWorkflowOp,
  getSavedWorkflowOp,
  listSavedWorkflowRunsOp,
  listSavedWorkflowsOp,
  moveSavedWorkflowOp,
  updateSavedWorkflowMetaOp,
} from "./saved-workflows.js";
import { listMcpServers } from "./mcp.js";
import { updateInteractionPreferences } from "./interaction-preferences.js";
import { updateAccountProviderConfig } from "./account-provider-config.js";
import { updateModelIoPreferences } from "./model-io-preferences.js";
import { updateOffPeakToolPolicy } from "./off-peak-tool-policy.js";
import { updateDynamicWorkflowPolicy } from "./dynamic-workflow-policy.js";
import { grantWorkspaceHookTrustForProtocol } from "./workspace-hook-trust.js";

import { ProtocolRequestError, type MyCodeProtocolAgentServerContext } from "./server-types.js";

import {
  type MyCodeProtocolPostResponseBatch,
  notifyWorkspaceHookTrustGrantSessions,
} from "./server-max-client-request-reannounce-interval-ms.js";
import type { ProtocolOperationCancellation } from "./operation-cancellation.js";
export interface ProtocolDispatchContext {
  context: MyCodeProtocolAgentServerContext;
  postResponseOutbox: Map<MyCodeProtocolRequestId, MyCodeProtocolPostResponseBatch>;
  operations: ProtocolOperationCancellation;
}
export async function dispatchProtocolRequest(
  context: ProtocolDispatchContext,
  request: MyCodeProtocolRequest,
) {
  switch (request.method) {
    // ── v4 conversation 通道（竖切，与旧 session/* 并存）──
    case V4_METHODS.connectionFlow: {
      requireV4Gateway(context.context).setConnectionFlowState(request.params);
      return {};
    }
    case V4_METHODS.conversationSubscribe: {
      // 同一 subscribe 方法按 topic 前缀分派：
      // sessions-index/* → 列表订阅；workspace-config/* → 配置目录订阅；否则 conversation。
      const gateway = requireV4Gateway(context.context);
      const topic = (request.params as { topic?: unknown } | null)?.topic;
      let dispatch;
      if (typeof topic === "string" && parseSessionsIndexTopic(topic) !== null) {
        dispatch = await gateway.subscribeSessionsIndexReserved(request.params);
      } else if (typeof topic === "string" && parseWorkspaceConfigTopic(topic) !== null) {
        dispatch = await gateway.subscribeWorkspaceConfigReserved(request.params);
      } else {
        dispatch = await gateway.subscribeReserved(request.params);
      }
      if (dispatch.initialWires.length > 0) {
        context.postResponseOutbox.set(request.id, {
          messages: dispatch.initialWires.map((wire) => ({
            method: V4_NOTIFICATIONS.conversationFrame,
            params: wire,
          })),
          commit: dispatch.commit,
        });
      }
      return { ack: dispatch.ack };
    }
    case V4_METHODS.conversationResync: {
      // same-sub recovery 与 subscribe 共用确定性 post-response outbox；公共
      // response 仍 strict ACK-only，physical recovery 只能在 ACK line 后发送。
      const dispatch = requireV4Gateway(context.context).resyncReserved(request.params);
      if (dispatch.initialWires.length > 0) {
        context.postResponseOutbox.set(request.id, {
          messages: dispatch.initialWires.map((wire) => ({
            method: V4_NOTIFICATIONS.conversationFrame,
            params: wire,
          })),
          commit: dispatch.commit,
        });
      }
      return { ack: dispatch.ack };
    }
    case V4_METHODS.conversationUnsubscribe: {
      // topic + subscriptionId + connectionId 精确命中唯一 publisher；禁止按裸
      // subId 对 conversation/sessions-index/workspace-config 广撒网。
      requireV4Gateway(context.context).unsubscribe(request.params);
      return {};
    }
    // ── 行分页 query（独立分支，便于与帧分派改动合并）──
    case V4_METHODS.conversationRowsRange:
      return await requireV4Gateway(context.context).rowsRange(request.params);
    case V4_METHODS.conversationPlans:
      return await requireV4Gateway(context.context).plans(request.params);
    case V4_METHODS.backgroundBashOutput:
      return await requireV4Gateway(context.context).backgroundBashOutput(request.params);
    case V4_METHODS.conversationFileChanges:
      return await requireV4Gateway(context.context).fileChanges(request.params);
    case V4_METHODS.conversationFileRewindPreview:
      return await requireV4Gateway(context.context).fileRewindPreview(request.params);
    // workflow run 事件日志分页（只读、无状态、超时重发安全；新方法天然偏斜安全）。
    case V4_METHODS.conversationWorkflowRunEvents:
      return await requireV4Gateway(context.context).workflowRunEvents(request.params);
    // dwf run 枚举（重启后的发现查询）。
    case V4_METHODS.conversationWorkflowRuns:
      return await requireV4Gateway(context.context).workflowRuns(request.params);
    // dwf 用户面产物的三个读面。同族：只读、无状态、
    // 超时重发安全；ArtifactRead 的授权在宿主端口侧，网关只校参数与分块。
    case V4_METHODS.conversationWorkflowRunArtifacts:
      return await requireV4Gateway(context.context).workflowRunArtifacts(request.params);
    case V4_METHODS.conversationWorkflowRunArtifactData:
      return await requireV4Gateway(context.context).workflowRunArtifactData(request.params);
    case V4_METHODS.conversationWorkflowRunArtifactRead:
      return await requireV4Gateway(context.context).workflowRunArtifactRead(request.params);
    // dwf 工作区 transcript 的两个读面。同族。
    case V4_METHODS.conversationWorkflowRunWorkspace:
      return await requireV4Gateway(context.context).workflowRunWorkspace(request.params);
    case V4_METHODS.conversationWorkflowRunNodeResult:
      return await requireV4Gateway(context.context).workflowRunNodeResult(request.params);
    // 附件只能走小 RPC transaction，禁止 full-data attachment/put 单行。
    case V4_METHODS.attachmentBegin:
      return await requireV4Gateway(context.context).attachmentBegin(request.params);
    case V4_METHODS.attachmentChunk:
      return await requireV4Gateway(context.context).attachmentChunk(request.params);
    case V4_METHODS.attachmentCommit:
      return await requireV4Gateway(context.context).attachmentCommit(request.params);
    case V4_METHODS.attachmentAbort:
      await requireV4Gateway(context.context).attachmentAbort(request.params);
      return {};
    case V4_METHODS.attachmentRead:
      return await requireV4Gateway(context.context).attachmentRead(request.params);
    case V4_METHODS.conversationAttachmentRead:
      return await requireV4Gateway(context.context).conversationAttachmentRead(request.params);
    case V4_METHODS.conversationAttachmentStat:
      return await requireV4Gateway(context.context).conversationAttachmentStat(request.params);
    case V4_METHODS.attachmentPreviewSource:
      return await requireV4Gateway(context.context).attachmentPreviewSource(request.params);
    // ── usage query（additive）：与旧 usage/stats、session/usage 同一数据访问
    // 层（usage store 聚合），仅换 v4 名字空间——不经 v4Gateway（无会话投影依赖），
    // 也不经旧 op 分派（无桥）。旧 case 保留到旧词删除（老 host 版本兼容）。──
    case V4_METHODS.usageStats:
      return await getUsageStats(context.context, request.params);
    case V4_METHODS.conversationUsage:
      return await getTaskTokenUsage(context.context, request.params);
    case V4_METHODS.command:
      return requireV4Gateway(context.context).handleCommand(request.params);
    case V4_METHODS.commandsQuery:
      return requireV4Gateway(context.context).queryCommands(request.params);
    case mycodeProtocolMethods.sessionCreate:
      return await createSession(context.context, request.params, request.trace);
    case mycodeProtocolMethods.sessionResume:
      return await resumeSession(context.context, request.params);
    case mycodeProtocolMethods.sessionList:
      return await listSessions(context.context, request.params);
    case mycodeProtocolMethods.sessionSubagents:
      return await listSessionSubagents(context.context, request.params);
    case mycodeProtocolMethods.sessionRead:
      return await readSession(context.context, request.params);
    case mycodeProtocolMethods.sessionMessages:
      return await readMessages(context.context, request.params);
    case mycodeProtocolMethods.sessionEvents:
      return await readEvents(context.context, request.params);
    case mycodeProtocolMethods.sessionSubscribe:
      return await subscribeSession(context.context, request.params);
    case mycodeProtocolMethods.sessionSend:
      return await sendPrompt(context.context, request.params);
    case mycodeProtocolMethods.sessionStop:
      return await stopSession(context.context, request.params);
    case mycodeProtocolMethods.sessionCancelBackgroundTask:
      return await cancelBackgroundTask(context.context, request.params);
    case mycodeProtocolMethods.sessionFork:
      return await forkSession(context.context, request.params);
    case mycodeProtocolMethods.sessionCompact:
      return await compactSession(context.context, request.params);
    case mycodeProtocolMethods.sessionGoal:
      return await goalSession(context.context, request.params);
    case mycodeProtocolMethods.sessionSetModel:
      return await setModel(context.context, request.params);
    case mycodeProtocolMethods.sessionSetThoughtLevel:
      return await setThoughtLevel(context.context, request.params);
    case mycodeProtocolMethods.sessionSetMode:
      return await setMode(context.context, request.params);
    case mycodeProtocolMethods.sessionClose:
      return await closeSession(context.context, request.params);
    case mycodeProtocolMethods.workspaceReadPresentation:
      return await readWorkspacePresentation(context.context, request.params);
    case mycodeProtocolMethods.workspaceHookTrustGrant: {
      const grantResult = await grantWorkspaceHookTrustForProtocol(request.params, {
        appVersion: context.context.deps.version,
        policyProvider: context.context.deps.workspaceHookPolicyProvider,
      });
      if (grantResult.accepted) {
        await notifyWorkspaceHookTrustGrantSessions({
          // dispatch 层的 params 是弱类型；grant 内部已用同一 schema parse 过，这里
          // safeParse 只为取出 workspaceKey 做匹配，失败即跳过通知（防御，正常必成功）。
          grantedWorkspaceKey: mycodeWorkspaceHookTrustGrantParamsSchema.safeParse(request.params)
            .success
            ? mycodeWorkspaceHookTrustGrantParamsSchema.parse(request.params).workspace.workspaceKey
            : undefined,
          sessions: context.context.sessions,
        });
      }
      return grantResult;
    }
    case mycodeProtocolMethods.providerUpdateAccountConfig:
      return await updateAccountProviderConfig(context.context, request.params);
    case mycodeProtocolMethods.workspaceUpdateInteractionPreferences:
      return await updateInteractionPreferences(context.context, request.params);
    case mycodeProtocolMethods.workspaceUpdateModelIoPreferences:
      return await updateModelIoPreferences(context.context, request.params);
    case mycodeProtocolMethods.workspaceUpdateOffPeakToolPolicy:
      return await updateOffPeakToolPolicy(context.context, request.params);
    case mycodeProtocolMethods.workspaceUpdateDynamicWorkflowPolicy:
      return await updateDynamicWorkflowPolicy(context.context, request.params);
    case mycodeProtocolMethods.workspaceGenerateText:
      return await context.operations.withWorkspaceGenerateTextSignal(request, (signal) =>
        generateWorkspaceText(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.workspaceCancelGenerateText:
      return context.operations.cancelWorkspaceGenerateText(request.params);
    case mycodeProtocolMethods.providerTestModelConnectivity:
      return await testProviderModelConnectivity(context.context, request.params);
    case mycodeProtocolMethods.mcpList:
      return await listMcpServers(context.context, request.params);
    case mycodeProtocolMethods.pluginsList:
      return await listPlugins(context.context, request.params);
    case mycodeProtocolMethods.pluginsReferenceCatalogWithCategory:
      return await getPluginReferenceCatalog(context.context, request.params, true);
    case mycodeProtocolMethods.pluginsReferenceCatalog:
      return await getPluginReferenceCatalog(context.context, request.params);
    case mycodeProtocolMethods.skillsReferenceCatalog:
      return await getSkillReferenceCatalog(context.context, request.params);
    case mycodeProtocolMethods.workflowsList:
      return await listSavedWorkflowsOp(context.context, request.params);
    case mycodeProtocolMethods.workflowsGet:
      return await getSavedWorkflowOp(context.context, request.params);
    case mycodeProtocolMethods.workflowsUpdateMeta:
      return await updateSavedWorkflowMetaOp(context.context, request.params);
    case mycodeProtocolMethods.workflowsDelete:
      return await deleteSavedWorkflowOp(context.context, request.params);
    case mycodeProtocolMethods.workflowsRuns:
      return await listSavedWorkflowRunsOp(context.context, request.params);
    case mycodeProtocolMethods.workflowsMove:
      return await moveSavedWorkflowOp(context.context, request.params);
    case mycodeProtocolMethods.pluginsResolveSuggestedReference:
      return await context.operations.withPluginOperationSignal(request, (signal) =>
        resolveSuggestedPluginReference(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.pluginsSetEnabled:
      return await context.operations.withPluginOperationSignal(request, (signal) =>
        setPluginEnabled(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.pluginsOverview:
      return await getPluginsOverview(context.context, request.params);
    case mycodeProtocolMethods.processChildProcesses:
      return listChildProcesses(context.context.deps.mcpTelemetry?.listProcesses() ?? []);
    case mycodeProtocolMethods.runtimeCapabilities:
      return { independentPlanState: true };
    case mycodeProtocolMethods.pluginsMarketplaceAdd:
      return await context.operations.withPluginOperationSignal(request, (signal) =>
        addPluginMarketplace(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.pluginsMarketplaceRemove:
      return await removePluginMarketplace(context.context, request.params);
    case mycodeProtocolMethods.pluginsMarketplaceUpdate:
      return await context.operations.withPluginOperationSignal(request, (signal) =>
        updatePluginMarketplace(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.pluginsInstall:
      return await context.operations.withPluginOperationSignal(request, (signal) =>
        installPlugin(context.context, request.params, signal),
      );
    case mycodeProtocolMethods.pluginsCancelOperation:
      return context.operations.cancelPluginOperation(request.params);
    case mycodeProtocolMethods.pluginsUninstall:
      return await uninstallPlugin(context.context, request.params);
    case mycodeProtocolMethods.pluginsUpdate:
      return await updatePlugin(context.context, request.params);
    case mycodeProtocolMethods.pluginsRestoreBuiltin:
      return await restoreBuiltinPlugin(context.context, request.params);
    case mycodeProtocolMethods.pluginsConfigure:
      return await configurePlugin(context.context, request.params);
    case mycodeProtocolMethods.pluginsResetConfig:
      return await resetPluginConfig(context.context, request.params);
    case mycodeProtocolMethods.pluginsValidate:
      return await validatePlugin(context.context, request.params);
    case mycodeProtocolMethods.pluginsDescribe:
      return await describePlugin(context.context, request.params);
    case mycodeProtocolMethods.usageStats:
      return await getUsageStats(context.context, request.params);
    case mycodeProtocolMethods.sessionDebug:
      return querySessionDebug(context.context, request.params);
    case mycodeProtocolMethods.sessionUsage:
      return await getTaskTokenUsage(context.context, request.params);
    default:
      throw new ProtocolRequestError(-32601, `Method not found: ${request.method}`);
  }
}
function requireV4Gateway(context: MyCodeProtocolAgentServerContext) {
  if (!context.v4Gateway) {
    throw new ProtocolRequestError(-32603, "v4 gateway is not initialized");
  }
  return context.v4Gateway;
}
