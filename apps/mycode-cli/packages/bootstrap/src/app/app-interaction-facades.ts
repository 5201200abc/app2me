import type { AppAssemblyContext } from "./app-assembly-context.js";

import { createResumePreparation } from "./app-resume-preparation.js";

import { AgentRuntime } from "@mycode/core";
import { createModelTelemetry } from "@mycode/telemetry";

import { resolveEffectiveLocale } from "./app-config-options.js";

import { createWorkflowFacade } from "./workflow-facade.js";
import { createInputFacade } from "./input-facade.js";

import { createSessionFacade } from "./session-facade.js";

import { resolveMyCodeCustomCommandPrompt } from "../custom-command-prompt.js";
import { resolveMyCodeBuiltinPromptCommand } from "../builtin-prompt-command.js";

import { ApiProviderModelRuntime } from "./provider-registry-model-runtime.js";

import type { AppPlatformPorts } from "./app-platform-ports.js";
import type { AppSessionConfiguration } from "./app-session-configuration.js";
import type { LoggerFactory } from "@mycode/contracts";
import type { createDynamicWorkflowRunService } from "./dynamic-workflow-run-service.js";
import type { PrepareUserExecutionBoundary } from "./types.js";
interface InteractionFacadeDeps
  extends AppAssemblyContext, AppPlatformPorts, AppSessionConfiguration {
  loggerFactory: LoggerFactory;
  storageRoot: string;
  cliStorageRoot: string;
  modelTelemetry: ReturnType<typeof createModelTelemetry>;
  modelFactory: ApiProviderModelRuntime["modelFactory"];
  runtime: AgentRuntime;
  prepareUserExecutionBoundary: PrepareUserExecutionBoundary;
  prepareResume: ReturnType<typeof createResumePreparation>["prepareResume"];
  dynamicWorkflowRunPort: ReturnType<typeof createDynamicWorkflowRunService> | undefined;
  closeNodeReplBrowserBroker: () => Promise<void>;
}
export function createAppInteractionFacades(deps: InteractionFacadeDeps) {
  const {
    options,
    appVersion,
    sessionId,
    traceContext,
    workingDirectory,
    configResult,
    logger,
    loggerFactory,
    storageRoot,
    cliStorageRoot,
    modelTelemetry,
    modelFactory,
    runtime,
    prepareUserExecutionBoundary,
    prepareResume,
    dynamicWorkflowRunPort,
    closeNodeReplBrowserBroker,
    artifactStore,
    executionPort,
    inputHistoryStore,
    imageProcessorPort,
    pdfDocumentPort,
    mcpPort,
    permissionService,
    ownsExecutionPort,
    ownsMcpPort,
    sessionStore,
    localSettingStore,
    projectID,
    configuredMcpServers,
    runtimeConfig,
    untrustedProjectMcpServers,
    ownsSessionStore,
  } = deps;
  const inputFacade = createInputFacade({
    artifactStore,
    customCommandPromptResolver: async (text, resolverOptions) => {
      const builtinPrompt = resolveMyCodeBuiltinPromptCommand(text, {
        // 动态工作流关闭时内置 `/workflow` 不得展开。目录侧已经把它从 `/` 面板
        // 剔除，但用户仍可手打命令名，两条路径必须给出同一个结论。TUI 缺席时不设门禁；
        // headless 按 --enable-workflow 显式取值，见 runtimeConfig 字段注释。
        dynamicWorkflowEnabled: runtimeConfig.dynamicWorkflowEnabled,
        workingDirectory,
      });
      if (builtinPrompt !== undefined) {
        return builtinPrompt;
      }
      return await resolveMyCodeCustomCommandPrompt(text, {
        env: options.env,
        executionPort,
        logger,
        projectConfigPath: options.projectConfigPath,
        sessionId,
        signal: resolverOptions?.abortSignal,
        skipUserConfig: options.skipUserConfig,
        traceContext: resolverOptions?.traceContext ?? traceContext,
        userConfigPath: options.userConfigPath,
        workingDirectory,
      });
    },
    inputHistoryStore,
    logger,
    prepareUserExecutionBoundary,
    runtime,
    sessionId,
    traceContext,
  });
  const workflowFacade = createWorkflowFacade({
    agentTelemetry: modelTelemetry.agentExecution,
    appOptions: options,
    appVersion,
    artifactStore,
    cliStorageRoot,
    configResult,
    eventSink: options.eventSink,
    imageProcessorPort,
    pdfDocumentPort,
    logger,
    mcpPort,
    modelFactory,
    permissionService,
    prepareUserExecutionBoundary,
    runtime,
    runtimeConfig,
    sessionId,
    sessionStore,
    storageRoot,
    traceContext,
    workingDirectory,
  });
  const sessionFacade = createSessionFacade({
    // App 关闭时停下本会话拥有的 dwf run：
    // 引擎活在本 App 的闭包里，关掉 App 而不停它，journal 行会停在 running 等下一次孤儿收敛。
    ...(dynamicWorkflowRunPort === undefined
      ? {}
      : { closeDynamicWorkflowRuns: () => dynamicWorkflowRunPort.close() }),
    configResult,
    configuredMcpServers,
    ...(options.configuredDefaultModelSelection
      ? {
          configuredDefaultModelSelection: options.configuredDefaultModelSelection,
        }
      : {}),
    executionPort,
    localSettingStore,
    logger,
    loggerFactory,
    mcpPort,
    ownsExecutionPort,
    ownsMcpPort,
    closeNodeReplBrowserBroker: async () => {
      await closeNodeReplBrowserBroker();
    },
    ownsSessionStore,
    prepareUserExecutionBoundary,
    prepareResume,
    projectID,
    providerRegistry: options.providerRegistry,
    resolveUiLocale: (locale) => resolveEffectiveLocale(locale, options),
    runtime,
    sessionId,
    sessionStore,
    traceContext,
    untrustedProjectMcpServers,
    workingDirectory,
  });
  return { inputFacade, workflowFacade, sessionFacade };
}
