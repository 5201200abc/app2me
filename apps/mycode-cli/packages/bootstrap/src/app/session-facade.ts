import { createSessionGoalOperations } from "./session-facade-goals.js";
import { updateUiLocaleInFileConfig } from "@mycode/adapters/config";
import { resolveLocale } from "@mycode/i18n";
import { normalizeModelSelection, type ModelSelection } from "@mycode/provider";
import {
  traceContextToLogContext,
  type CollaborationMode,
  type MessageId,
  type UiThemePreference,
} from "@mycode/contracts";
import { listMcpServerStatuses } from "../mcp-config.js";
import { loadSessionTranscriptFromStore } from "../session-transcript.js";
import { createSubagentObservation } from "./subagent-observation.js";
import { getLocaleConfigPath } from "./locale-selection.js";
import { isClosableSessionStore } from "./session-store.js";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";
import {
  completeAuxiliaryRegistryModelSelection,
  getRegistryBackedModel,
  listRegistryBackedModels,
  requireRegistryThoughtLevel,
  resolveRegistryModelSelection,
  resolveRegistryOwnedModelSelection,
  resolveRegistryOwnedSelection,
  resolveRegistryThoughtLevel,
  type ResolvedRegistrySelection,
} from "./provider-registry-selection.js";
import type { MyCodeApp } from "./types.js";
import {
  type CreateSessionFacadeDeps,
  type SessionFacade,
  closeSessionResources,
  formatLegacyRuntimeModelValue,
  persistSessionModelSelection,
} from "./session-facade-session-facade.js";

export function createSessionFacade(deps: CreateSessionFacadeDeps): SessionFacade {
  let closePromise: Promise<void> | undefined;
  let currentLocale = resolveLocale(deps.configResult.config.ui.locale);
  const currentRegistrySelection = ():
    | { owned: false }
    | {
        owned: true;
        registry: ProviderRegistryModelSource;
        selection?: ResolvedRegistrySelection;
      } => {
    const registry = deps.providerRegistry;
    const selection = deps.runtime.getSessionModelSelection();
    if (!selection) return { owned: false };
    const { providerId } = selection;
    if (!registry.getProvider(providerId)) return { owned: false };
    const resolved = resolveRegistryModelSelection(registry, selection);
    return resolved ? { owned: true, registry, selection: resolved } : { owned: true, registry };
  };
  const { readTargetWithInterruptedRunRecovery, setTargetStatus } =
    createSessionGoalOperations(deps);

  return {
    close: async () => {
      closePromise ??= (async () => {
        // 关闭入口先阻止新调度并取消在飞 Memory Extraction，再等待取消链路收口。
        deps.runtime.beginShutdown();
        await deps.runtime.drainMemoryExtractions(60_000);
        // 引擎归本 App 所有，所以关闭要主动停下它。
        // 位置是两个约束夹出来的：在 beginShutdown **之后**，结算带出的终态通知才会被丢掉
        // （background-notifications.ts 在 shuttingDown 时不入队），不会把正在关闭的会话的模型
        // 叫醒；在 closeSessionResources **之前**，子代理还有 execution / MCP / session store
        // 可以干净地中止，引擎也还有 journal 可以写自己那一笔 stopped(interrupted)。
        if (deps.closeDynamicWorkflowRuns !== undefined) {
          try {
            await deps.closeDynamicWorkflowRuns();
          } catch (error: unknown) {
            // 卡住或抛错的 dwf 关闭绝不能吃掉资源关闭（同下面并行关闭那条注释的论证）：
            // 记一条 warn 继续走，最坏情况是那个 run 留成孤儿行，下一次构造时被收敛。
            deps.logger.warn?.(
              "Closing dynamic workflow runs failed; continuing to close resources",
              {
                errorMessage: error instanceof Error ? error.message : String(error),
                event: "dynamic_workflow.service.close_failed",
                module: "bootstrap.app",
              },
            );
          }
        }
        const closableSessionStore =
          deps.ownsSessionStore && isClosableSessionStore(deps.sessionStore)
            ? deps.sessionStore
            : undefined;
        await closeSessionResources({
          beginShutdown: () => deps.runtime.beginShutdown(),
          closeBrowserSession: () => deps.runtime.closeBrowserSession(),
          closeExecution:
            deps.ownsExecutionPort && deps.executionPort.close
              ? () => deps.executionPort.close?.()
              : undefined,
          closeMcp: deps.ownsMcpPort && deps.mcpPort ? () => deps.mcpPort?.close() : undefined,
          closeNodeReplBrowserBroker: deps.closeNodeReplBrowserBroker,
          closeSessionStore: closableSessionStore ? () => closableSessionStore.close() : undefined,
          logger: deps.logger,
        });
      })();
      return await closePromise;
    },
    getMode: () => deps.runtime.getMode(),
    getModel: () => formatLegacyRuntimeModelValue(deps.runtime.getSessionModelSelection()),
    getLocale: () => currentLocale,
    getTheme: () => deps.configResult.config.ui.theme as UiThemePreference,
    getDefaultThoughtLevel: () => {
      const registryState = currentRegistrySelection();
      return registryState.owned
        ? resolveRegistryThoughtLevel(registryState.selection)
        : deps.runtime.getSessionModelSelection()?.options?.reasoningLevel;
    },
    // 当前档位只读会话事实；缺失时不能借默认档位伪装成已完成选择。
    getThoughtLevel: () => deps.runtime.getSessionModelSelection()?.options?.reasoningLevel,
    loadSessionTranscript: async () =>
      await loadSessionTranscriptFromStore({
        sessionId: deps.sessionId,
        sessionStore: deps.sessionStore,
      }),
    ...createSubagentObservation(deps),
    readTodos: async () => deps.sessionStore.readTodos({ sessionID: deps.sessionId }),
    readTarget: readTargetWithInterruptedRunRecovery,
    setCustomSessionTitle: async (input) =>
      deps.runtime.setCustomSessionTitle({
        title: input.title,
        traceContext: input.traceContext ?? deps.traceContext,
      }),
    setTarget: async (input) =>
      (await setTargetStatus("set", input)) as Awaited<ReturnType<MyCodeApp["setTarget"]>>,
    updateTargetStatus: async (status) =>
      (await setTargetStatus("status_updated", { status })) as Awaited<
        ReturnType<MyCodeApp["updateTargetStatus"]>
      >,
    clearTarget: async () => (await setTargetStatus("cleared", {})) as boolean,
    listModels: () => {
      return listRegistryBackedModels(deps.providerRegistry);
    },
    getCurrentModelOption: () => {
      const selection = deps.runtime.getSessionModelSelection();
      return selection && getRegistryBackedModel(deps.providerRegistry, selection);
    },
    getModelOption: (selection) => getRegistryBackedModel(deps.providerRegistry, selection),
    listThoughtLevels: () => {
      const registryState = currentRegistrySelection();
      return registryState.owned
        ? [...(registryState.selection?.model.config.optionSpecs.reasoningLevel.values ?? [])]
        : [];
    },
    listMcpServers: async () =>
      listMcpServerStatuses(
        deps.mcpPort,
        deps.configuredMcpServers,
        deps.untrustedProjectMcpServers,
      ),
    connectMcpServer: async (name) => {
      const config = deps.configuredMcpServers[name];
      if (!config) {
        throw new Error(`MCP server is not configured: ${name}`);
      }
      if (!deps.mcpPort) {
        throw new Error("MCP is disabled");
      }
      return deps.mcpPort.connectServer(name, config, {
        trace: deps.traceContext,
        workingDirectory: deps.workingDirectory,
      });
    },
    readBackgroundBashOutput: (workId, sessionId) =>
      deps.runtime.readBackgroundBashOutput(workId, sessionId),
    cancelBackgroundTask: async (taskId, options) =>
      deps.runtime.cancelBackgroundTask(taskId, {
        traceContext: options?.traceContext ?? deps.traceContext,
      }),
    disconnectMcpServer: async (name) => {
      if (!deps.mcpPort) return undefined;
      return deps.mcpPort.disconnectServer(name);
    },
    listCheckpoints: async (options) => {
      await deps.prepareResume();
      return deps.runtime.listWorkspaceCheckpoints(options);
    },
    forkFromCheckpoint: async (options) => {
      await deps.prepareResume(options?.traceContext);
      return deps.runtime.forkWorkspaceFromCheckpoint({
        targetCheckpointId: options?.targetCheckpointId,
        targetMessageId: options?.targetMessageId as MessageId | undefined,
        traceContext: options?.traceContext ?? deps.traceContext,
      });
    },
    generateWorkspaceText: async (input, options) => {
      // 辅助文本入口只规范化模型身份；具体的最低档位由 Core 的辅助请求调用点显式决定。
      const selection =
        normalizeModelSelection(deps.providerRegistry.getView(), input.selection) ??
        input.selection;
      return await deps.runtime.generateWorkspaceText(
        { ...input, selection },
        {
          abortSignal: options?.abortSignal,
          traceContext: options?.traceContext ?? deps.traceContext,
        },
      );
    },
    testModelConnectivity: async (input, options) => {
      // 连接测试用的 Model 也要先绑定最低档位，否则严格 Factory 会先因缺档位失败。
      const selection = completeAuxiliaryRegistryModelSelection(
        deps.providerRegistry,
        input.selection,
      );
      await deps.runtime.testModelConnectivity(
        { ...input, selection },
        {
          abortSignal: options?.abortSignal,
          traceContext: options?.traceContext ?? deps.traceContext,
        },
      );
    },
    setMode: async (mode: CollaborationMode) => {
      const previousMode = deps.runtime.getMode();
      await deps.runtime.setExecutionState({ mode }, deps.traceContext);
      if (deps.localSettingStore) {
        try {
          await deps.localSettingStore.saveProjectPermissionMode({
            mode: deps.runtime.getMode(),
            projectID: deps.projectID,
          });
        } catch (error) {
          deps.logger.warn("Project mode preference write failed", {
            ...traceContextToLogContext(deps.traceContext),
            error: error instanceof Error ? error.message : String(error),
            event: "local_setting.permission_mode.write_failed",
            mode,
            module: "bootstrap",
            projectId: deps.projectID,
            status: "failed",
          });
        }
      }
      deps.logger.info("Session mode updated", {
        ...traceContextToLogContext(deps.traceContext),
        event: "session.mode.updated",
        mode,
        module: "bootstrap",
        previousMode,
        status: "completed",
      });
      return {
        mode: deps.runtime.getMode(),
        previousMode,
        traceId: deps.traceContext.traceId,
      };
    },
    setModel: async (modelId, options) => {
      // 配置命令已提交完整 Selection；转成字符串会丢档位。先整体校验再一次
      // 更新/保存，非法档位不能留下已换模型的半次修改。旧字符串入口保留只改身份语义。
      const registrySelection =
        typeof modelId === "string"
          ? resolveRegistryOwnedSelection(
              deps.providerRegistry,
              modelId,
              deps.configuredDefaultModelSelection,
              { allowMissingReasoning: true },
            )
          : resolveRegistryOwnedModelSelection(deps.providerRegistry, modelId);
      if (!registrySelection) {
        throw new Error(`Provider Registry 中不存在 Model: ${modelId}`);
      }
      const previousSelection = deps.runtime.getSessionModelSelection();
      const previousModel = formatLegacyRuntimeModelValue(previousSelection);
      const model = formatLegacyRuntimeModelValue(registrySelection.selection);
      const sessionSelection: ModelSelection = {
        providerId: registrySelection.selection.providerId,
        modelId: registrySelection.selection.modelId,
        ...(typeof modelId !== "string" && registrySelection.selection.options
          ? { options: { ...registrySelection.selection.options } }
          : {}),
      };
      deps.runtime.setSessionModelSelection(sessionSelection);
      if (!options?.transient) {
        deps.runtime.recordPendingModelChange({
          fromModel: previousSelection,
          fromModelLabel: previousModel,
          toModel: sessionSelection,
          toModelLabel: model,
        });
        await persistSessionModelSelection(deps);
      }
      deps.logger.info("Session model updated", {
        ...traceContextToLogContext(deps.traceContext),
        event: "session.model.updated",
        model,
        module: "bootstrap",
        previousModel,
        status: "completed",
      });
      return {
        model,
        previousModel,
        traceId: deps.traceContext.traceId,
      };
    },
    setThoughtLevel: async (level) => {
      const registryState = currentRegistrySelection();
      if (registryState.owned) {
        const currentSelection = deps.runtime.getSessionModelSelection();
        if (!currentSelection) throw new Error("Select a model before choosing reasoning effort");
        const registrySelection =
          registryState.selection ??
          resolveRegistryOwnedModelSelection(registryState.registry, {
            providerId: currentSelection.providerId,
            modelId: currentSelection.modelId,
          })!;
        const previousThoughtLevel = resolveRegistryThoughtLevel(
          registrySelection,
          currentSelection.options?.reasoningLevel,
        );
        const thoughtLevel = requireRegistryThoughtLevel(registrySelection, level);
        deps.runtime.setSessionModelSelection({
          ...currentSelection,
          options: {
            ...currentSelection.options,
            reasoningLevel: thoughtLevel,
          },
        });
        await persistSessionModelSelection(deps);
        deps.logger.info("Session reasoning effort updated", {
          ...traceContextToLogContext(deps.traceContext),
          event: "session.reasoning_effort.updated",
          module: "bootstrap",
          previousThoughtLevel,
          status: "completed",
          thoughtLevel,
        });
        return {
          previousThoughtLevel,
          thoughtLevel,
          traceId: deps.traceContext.traceId,
        };
      }
      throw new Error("当前 Session Model 不属于 Provider Registry");
    },
    setLocale: async (locale) => {
      const previousLocale = currentLocale;
      const configPath = getLocaleConfigPath(deps.configResult);
      const persisted = await updateUiLocaleInFileConfig(configPath, locale);
      currentLocale = deps.resolveUiLocale(locale);
      deps.configResult.config.ui.locale = currentLocale;
      deps.logger.info("Session locale updated", {
        ...traceContextToLogContext(deps.traceContext),
        event: "session.locale.updated",
        locale: currentLocale,
        module: "bootstrap",
        previousLocale,
        requestedLocale: locale,
        status: "completed",
      });
      return {
        configPath: persisted.path,
        locale: currentLocale,
        previousLocale,
        requestedLocale: locale,
        traceId: deps.traceContext.traceId,
      };
    },
  };
}
