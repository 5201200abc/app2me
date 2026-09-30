import { createAppStartupContext } from "./app-startup-context.js";
import { resolveAppSessionConfiguration } from "./app-session-configuration.js";
import { createAppInteractionFacades } from "./app-interaction-facades.js";

import { createAttachmentFacade } from "./app-attachment-facade.js";
import { createHookReviewFacade } from "./app-hook-review-facade.js";
import { createDynamicWorkflowFacade } from "./app-dynamic-workflow-facade.js";
import { createResumePreparation } from "./app-resume-preparation.js";
import { createAppPlatformPorts } from "./app-platform-ports.js";
import { createAppDynamicWorkflowService } from "./app-dynamic-workflow-assembly.js";

import { createInMemorySessionEventStore } from "@mycode/adapters/storage";

import { resolvePath } from "@mycode/adapters/config";

import { createNodeContextSourceAdapter } from "@mycode/adapters/context";
import { createNodeSkillAdapter } from "@mycode/adapters/skills";

import { AgentRuntime, buildPluginReferenceCatalog } from "@mycode/core";

import { createSessionEvent } from "@mycode/contracts";
import { isRemoteWorkspaceIdentity, resolveMyCodeRuntimeEnv } from "@mycode/shared";

import { createModelAdapter } from "../model-factory.js";

import { scheduleStartupLogRetentionCleanup } from "../log-retention.js";
import type { MyCodeApp, MyCodeAppOptions } from "./types.js";

import { getCliStorageRoot, getModelIoDir } from "./paths.js";

import { createPluginFacadeForApp } from "./plugin-facade.js";

import { runtimeConfigLogContext } from "./runtime-config.js";

import { collectDynamicWorkflowDisabledSkillPaths } from "./dynamic-workflow-gate.js";
import { createWorkspaceHookRuntimeSecurity } from "./workspace-hook-trust.js";
import { createScriptWorkflowBridge } from "./script-workflow-methods.js";

import { getWorkflowConcurrencyGovernor } from "./workflow-concurrency-governor.js";
import { createDynamicWorkflowSnippetService } from "./dynamic-workflow-snippet-service.js";
import { createModelCatalogPort } from "./model-catalog-port.js";

import {
  createNodeReplBrowserBroker,
  injectNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "./node-repl-browser-broker.js";

import { collectDisabledPaths } from "../skill-command-overrides.js";

import { createRuntimeAiSdkModelExecutionConfig } from "../model-config.js";
import { ApiProviderModelRuntime } from "./provider-registry-model-runtime.js";
import { completeAppStartup, markRuntimeConstructed } from "./startup-marks.js";

export async function createMyCodeApp(options: MyCodeAppOptions): Promise<MyCodeApp> {
  if (!options?.providerRegistry) {
    throw new Error("createMyCodeApp requires a Provider Registry");
  }
  const appContext = createAppStartupContext(options);
  const {
    appVersion,
    sessionId,
    traceContext,
    workingDirectory,
    configResult,
    logger,
    startupTimer,
    loggerFactory,
    modelLogger,
    modelTelemetry,
  } = appContext;
  let nodeReplBrowserBroker: NodeReplBrowserBroker | undefined;
  let ownedNodeReplBrowserBroker: NodeReplBrowserBroker | undefined;
  let providerModelRuntime: ApiProviderModelRuntime | undefined;
  try {
    const storageRoot = resolvePath(configResult.config.storage.dir);
    const cliStorageRoot = getCliStorageRoot(storageRoot);
    const modelIoDir = getModelIoDir(
      cliStorageRoot,
      resolveMyCodeRuntimeEnv(options.env ?? process.env) === "development",
    );
    const sessionConfiguration = await resolveAppSessionConfiguration({
      ...appContext,
      storageRoot,
      cliStorageRoot,
    });
    const {
      pluginOutcome,
      bundledSkillRoots,
      pluginRuntimeFeatures,
      ownsSessionStore,
      sessionStore,
      localSettingStore,
      projectID,
    } = sessionConfiguration;
    let { configuredMcpServers, runtimeConfig, untrustedProjectMcpServers } = sessionConfiguration;
    const browserControlPort = options.browserControlPort;
    if (
      browserControlPort &&
      pluginRuntimeFeatures.browserUse === true &&
      runtimeConfig.mcp?.servers?.node_repl?.type === "stdio"
    ) {
      nodeReplBrowserBroker =
        options.nodeReplBrowserBroker ??
        (ownedNodeReplBrowserBroker = createNodeReplBrowserBroker({
          browserControlPort,
          logger,
          platform: options.platform,
        }));
      configuredMcpServers = injectNodeReplBrowserBroker(
        configuredMcpServers,
        nodeReplBrowserBroker,
      );
      runtimeConfig.mcp = {
        ...runtimeConfig.mcp,
        servers: injectNodeReplBrowserBroker(
          runtimeConfig.mcp.servers ?? {},
          nodeReplBrowserBroker,
        ),
      };
    }
    startupTimer.mark("MyCode runtime configuration resolved", {
      context: runtimeConfigLogContext(runtimeConfig, workingDirectory),
      event: "bootstrap.app.startup.runtime_config.completed",
      stage: "resolve_runtime_config",
    });
    // Plugin 对话引用：身份 catalog 在 App（Session runtime）
    // 创建时冻结一次。冷恢复会重建 App，天然拿到新 catalog；已有 Session 不热加载新 Plugin。
    const pluginReferenceCatalog = buildPluginReferenceCatalog(pluginOutcome.plugins);
    runtimeConfig.pluginReferenceCatalog = pluginReferenceCatalog;
    let runtime: AgentRuntime | undefined;
    const workspaceHookRuntimeSecurity = createWorkspaceHookRuntimeSecurity({
      appVersion,
      logger,
      projectConfigPath: options.projectConfigPath,
      policy: options.workspaceHookPolicy,
      policyProvider: options.workspaceHookPolicyProvider,
      reviewHost: options.workspaceHookReviewHost,
      workspaceHookTrustEnabled: options.workspaceHookTrustEnabled,
      runtimeRoot: configResult.sources.project.workspaceHookRuntimeRoot ?? {
        // Fallback 只在 config-factory 未导出时生效（理论上不会发生）。
        // 此处原本无条件按单层 runtimeConfig.hooks 重建 runtimeRoot，与
        // config-factory 遍历 default/user/project/env/cli 全部层的推导不一致，
        // 导致 review 快照与 toggle 重建的 bundleDigest 不同，
        // 「审核中 toggle」被误报为 workspace_hooks_snapshot_mismatch。
        enabled: runtimeConfig.hooks?.enabled === true,
        timeoutMs: runtimeConfig.hooks?.timeoutMs ?? 60_000,
        maxOutputBytes: runtimeConfig.hooks?.maxOutputBytes ?? 32_768,
      },
      sessionId,
      snapshot: configResult.sources.project.workspaceHookSnapshot,
      userConfigPath: configResult.sources.user.path,
      workingDirectory,
      ...(options.workspaceHookReviewHost
        ? {
            emitReviewEvent: async (event) => {
              if (!runtime) throw new Error("MyCode runtime is not initialized yet.");
              await runtime.appendEvent(
                createSessionEvent(event.type, sessionId, event.payload, {
                  traceId: traceContext.traceId,
                }),
                traceContext,
              );
            },
            emitAdmissionEvent: async (event) => {
              if (!runtime) throw new Error("MyCode runtime is not initialized yet.");
              await runtime.appendEvent(
                createSessionEvent(event.type, sessionId, event.payload, {
                  traceId: traceContext.traceId,
                }),
                traceContext,
              );
            },
          }
        : {}),
    });
    const platformPorts = createAppPlatformPorts({
      ...appContext,
      storageRoot,
      cliStorageRoot,
      sessionStore,
      runtimeConfig,
      configuredMcpServers,
    });
    const {
      permissionService,
      inputHistoryStore,
      artifactStore,
      imageProcessorPort,
      sessionMailboxPort,
      mcpPort,
      ownsMcpPort,
      executionPort,
      ownsExecutionPort,
      pdfDocumentPort,
      fileSystemPort,
      httpClientPort,
    } = platformPorts;
    const getRuntime = (): AgentRuntime => {
      if (!runtime) throw new Error("MyCode runtime is not initialized yet.");
      return runtime;
    };
    const { prepareResume, prepareUserExecutionBoundary, resumeFromStore } =
      createResumePreparation({ ...appContext, sessionStore, getRuntime });

    const modelExecutionConfig = createRuntimeAiSdkModelExecutionConfig(options.env, {
      appVersion,
      network: configResult.config.network,
      sourceTitle: options.sourceTitle,
    });
    const modelAdapter =
      options.modelAdapter ??
      createModelAdapter({
        env: options.env,
        logger: modelLogger,
        modelIoDir,
        modelIoFullRetentionEnabled: options.modelIoFullRetentionEnabled,
        executionConfig: modelExecutionConfig,
        statusSink: modelTelemetry.statusSink,
        streamIdleTimeoutMs: configResult.config.modelStream.idleTimeoutMs,
      });
    if (options.modelAdapter && modelTelemetry.statusSink) {
      modelAdapter.addStatusSink(modelTelemetry.statusSink);
    }
    // 进程级并发治理器：run service 拿它的窄端口给
    // driver（每个 actor runtime 一个请求级准入端口）；主 runtime 挂它的 observer（下面 deps）——
    // 不排队、不看冷却，但计入在飞并喂信号。进程级单例——配额本就在账号上，不按会话分。
    // 不再经 adapter 级 addStatusSink 喂信号：同一事件只能沿 ticket 喂一次。
    const workflowConcurrencyGovernor = getWorkflowConcurrencyGovernor();
    modelAdapter.setModelIoFullRetentionEnabled(options.modelIoFullRetentionEnabled ?? false);
    providerModelRuntime = new ApiProviderModelRuntime({
      registry: options.providerRegistry,
      modelAdapter,
    });
    providerModelRuntime.start();
    // model factory 提前到三条 workflow child 装配线之前构造：script workflow bridge、dwf actor
    // runtime 与 expert workflow facade 都**共享**父会话这一份 factory——Registry 视图更新后
    // 新建的 Model 才看得到，child 不各自冻结一份。
    const modelFactory = providerModelRuntime.modelFactory;
    const scriptWorkflowFacade = createScriptWorkflowBridge({
      agentTelemetry: modelTelemetry.agentExecution,
      appOptions: options,
      appVersion,
      artifactStore,
      configResult,
      fileSystemPort,
      httpClientPort,
      imageProcessorPort,
      pdfDocumentPort,
      logger,
      mcpPort,
      modelFactory,
      permissionService,
      prepareUserExecutionBoundary,
      getRuntime,
      runtimeConfig,
      sessionId,
      sessionStore,
      storageRoot,
      traceContext,
      workingDirectory,
    });
    const dynamicWorkflowRunPort = createAppDynamicWorkflowService({
      ...appContext,
      ...platformPorts,
      sessionStore,
      storageRoot,
      runtimeConfig,
      getRuntime,
      modelFactory,
      modelTelemetry,
      workflowConcurrencyGovernor,
    });
    // dwf snippet service：EvalWorkflowSnippet 的执行面。刻意**不**依赖 dwf journal——
    // snippet 完全瞬态（内存 journal），不该被 run service 的 durability 前提连坐；
    // 所以即使 run 端口因 journal 缺席而不构造，实验通道仍然可用。
    const dynamicWorkflowSnippetPort = createDynamicWorkflowSnippetService({
      executionPort,
      fileSystemPort,
      logger,
    });
    // 模型目录：工具层把用户说的模型名解析成 workflow run 的子代理选型（model-catalog-port.ts）。
    const modelCatalogPort = createModelCatalogPort({
      registry: options.providerRegistry,
      currentSelection: () => getRuntime().getSessionModelSelection(),
    });
    runtime = new AgentRuntime(sessionId, runtimeConfig, {
      agentTelemetry: modelTelemetry.agentExecution,
      // 主代理的模型请求过治理器的 observer：立即放行，但让治理器看见它的 429 / 成功。
      modelRequestAdmission: workflowConcurrencyGovernor.observer(),
      eventStore: options.eventStore ?? createInMemorySessionEventStore(),
      sessionStore,
      sessionMailboxPort,
      logger,
      executionPort,
      workspaceHookAdmission: workspaceHookRuntimeSecurity?.admission,
      workspaceHookSnapshot: workspaceHookRuntimeSecurity?.snapshot,
      browserControlPort,
      fileSystemPort,
      httpClientPort,
      imageProcessorPort,
      pdfDocumentPort,
      artifactStore,
      contextSourcePort:
        options.contextSourcePort ?? createNodeContextSourceAdapter({ env: options.env }),
      skillPort:
        configResult.config.features.skill && configResult.config.skills.enabled
          ? (options.skillPort ??
            createNodeSkillAdapter({
              extraRoots: configResult.config.skills.roots,
              extraResolvedRoots: [...pluginOutcome.skillRoots, ...bundledSkillRoots],
              disabledPaths: [
                ...collectDisabledPaths(configResult.config.skillOverrides),
                // 动态工作流关闭时不提供 dynamic-workflows 技能：
                // 十个工具都不在场，再让模型读到「怎么写工作流脚本」只会诱导它去调不存在的工具。
                ...(runtimeConfig.dynamicWorkflowEnabled === false
                  ? collectDynamicWorkflowDisabledSkillPaths(bundledSkillRoots)
                  : []),
              ],
            }))
          : undefined,
      mcpPort,
      eventSink: options.eventSink,
      modelFactory,
      modelIoDir,
      providerRuntimeHeadersPort: options.providerRuntimeHeadersPort,
      resolveEffectiveModelSelection: options.resolveEffectiveModelSelection,
      isRemoteWorkspace: () =>
        isRemoteWorkspaceIdentity(runtimeConfig.memory?.workspaceIdentity ?? ""),
      permissionBroker: options.permissionBroker,
      permissionService,
      workflowPort: scriptWorkflowFacade.workflowPort,
      dynamicWorkflowRunPort,
      dynamicWorkflowSnippetPort,
      modelCatalogPort,
      automationPort: options.automationPort,
      offPeakPort: options.offPeakPort,
      appVersion,
      traceContext,
    });
    markRuntimeConstructed({
      hasInjectedModelAdapter: options.modelAdapter !== undefined,
      sessionId,
      startupTimer,
    });
    completeAppStartup({
      sessionId,
      startupTimer,
      workingDirectory,
    });
    scheduleStartupLogRetentionCleanup(loggerFactory, logger);
    const { inputFacade, workflowFacade, sessionFacade } = createAppInteractionFacades({
      ...appContext,
      ...platformPorts,
      ...sessionConfiguration,
      loggerFactory,
      storageRoot,
      cliStorageRoot,
      modelTelemetry,
      modelFactory,
      runtime,
      prepareUserExecutionBoundary,
      prepareResume,
      dynamicWorkflowRunPort,
      configuredMcpServers,
      runtimeConfig,
      untrustedProjectMcpServers,
      closeNodeReplBrowserBroker: async () => {
        await ownedNodeReplBrowserBroker?.close();
      },
    });

    const closeSession = sessionFacade.close;
    return {
      sessionId,
      traceId: traceContext.traceId,
      runtime,
      ...createHookReviewFacade(workspaceHookRuntimeSecurity),
      setModelIoFullRetentionEnabled: (enabled) =>
        modelAdapter.setModelIoFullRetentionEnabled(enabled),
      ...createAttachmentFacade({
        sessionId,
        traceContext,
        sessionStore,
        artifactStore,
        fileSystemPort,
      }),
      ...sessionFacade,
      close: async () => {
        try {
          await closeSession?.();
        } finally {
          try {
            providerModelRuntime?.dispose();
          } finally {
            await modelTelemetry.shutdown();
          }
        }
      },
      ...workflowFacade,
      ...scriptWorkflowFacade,
      ...createDynamicWorkflowFacade({
        dynamicWorkflowRunPort,
        getRuntime,
        prepareUserExecutionBoundary,
        traceContext,
      }),
      ...createPluginFacadeForApp({ configResult, options, workingDirectory }),
      getPluginReferenceCatalog: () => pluginReferenceCatalog,
      getSkillCatalog: async () => {
        // Skill 目录属于 context 初始化结果。冷恢复必须先恢复 Session 边界，再读取
        // 新 runtime 的快照，不能绕开 resume 后用旧工作目录独立扫描。
        await prepareUserExecutionBoundary({ traceContext });
        return await getRuntime().getSkillCatalog(traceContext);
      },
      resume: resumeFromStore,
      ...inputFacade,
    };
  } catch (error) {
    providerModelRuntime?.dispose();
    void modelTelemetry.shutdown().catch(() => undefined);
    void ownedNodeReplBrowserBroker?.close();
    startupTimer.fail("MyCode app startup failed", error, {
      context: { sessionId, workingDirectory },
      event: "bootstrap.app.startup.failed",
      stage: "total",
    });
    throw error;
  }
}
