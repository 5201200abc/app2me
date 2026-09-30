import type { AppAssemblyContext } from "./app-assembly-context.js";

import { join } from "node:path";

import { projectIdFromDirectory } from "./paths.js";
import {
  asLocalSettingStore,
  openStartupSessionStore,
  readProjectPermissionMode,
} from "./session-store.js";

import { resolvePluginRuntimeFeatures } from "./plugin-runtime-features.js";

import { resolveAppRuntimeConfig } from "./runtime-config.js";
import { resolveBundledSkillRoots } from "./bundled-skills.js";

import { resolveBuiltInNodeReplMcpServers } from "./built-in-node-repl.js";

import { loadPluginAgentProfiles, loadMyCodeAgentProfiles } from "../subagents.js";

import { resolveStartupPlugins } from "./startup-marks.js";
interface SessionConfigurationDeps extends Pick<
  AppAssemblyContext,
  "options" | "configResult" | "logger" | "startupTimer" | "workingDirectory"
> {
  storageRoot: string;
  cliStorageRoot: string;
}
export async function resolveAppSessionConfiguration(deps: SessionConfigurationDeps) {
  const {
    options,
    configResult,
    logger,
    startupTimer,
    workingDirectory,
    storageRoot,
    cliStorageRoot,
  } = deps;
  const mycodeSubagentProfileOutcome = await loadMyCodeAgentProfiles({
    logger,
    storageRoot,
    workingDirectory,
  });
  const mycodeSubagentProfiles = mycodeSubagentProfileOutcome.profiles;
  const pluginOutcome = resolveStartupPlugins({
    cliStorageRoot,
    configResult,
    env: options.env,
    logger,
    options,
    startupTimer,
    workingDirectory,
  });
  // 随 CLI 内置的技能包（dynamic-workflows 等）：不属于任何插件，用户无法停用或卸载。
  const bundledSkillRoots = await resolveBundledSkillRoots({ cliStorageRoot, logger });
  const pluginSubagentProfiles = loadPluginAgentProfiles({
    logger,
    plugins: pluginOutcome.plugins,
    reservedProfileNames: mycodeSubagentProfiles.map((profile) => profile.name),
    modelSelectionOverrides: mycodeSubagentProfileOutcome.pluginAgentModelSelectionOverrides,
  }).profiles;
  const pluginRuntimeFeatures = resolvePluginRuntimeFeatures(pluginOutcome);
  const builtInMcpServers = resolveBuiltInNodeReplMcpServers({
    pluginOutcome,
    workingDirectory,
  });
  // 用户目录已在 loader 前完成原地迁移；不能给项目/插件旧身份加内存兼容旁路。
  const subagentProfiles = [...mycodeSubagentProfiles, ...pluginSubagentProfiles];
  const ownsSessionStore = options.sessionStore === undefined;
  const sessionStore =
    options.sessionStore ?? (await openStartupSessionStore(configResult, startupTimer));
  const localSettingStore = asLocalSettingStore(sessionStore);
  const projectID = projectIdFromDirectory(workingDirectory);
  const persistedMode = options.runtimeConfig?.mode
    ? undefined
    : readProjectPermissionMode(localSettingStore, projectID);
  let { configuredMcpServers, runtimeConfig, untrustedProjectMcpServers } = resolveAppRuntimeConfig(
    {
      cliStorageRoot,
      configResult,
      options,
      persistedMode,
      pluginHooks: pluginOutcome.hooks,
      pluginMcpServers: pluginOutcome.mcpServers,
      builtInMcpServers,
      pluginRuntimeFeatures,
      builtInSubagentModelSelectionOverrides:
        mycodeSubagentProfileOutcome.builtInModelSelectionOverrides,
      subagentOutputRootDir: join(cliStorageRoot, "agents"),
      subagentProfiles,
      storageRoot,
      workingDirectory,
      workspaceIdentity: options.runtimeConfig?.memory?.workspaceIdentity,
    },
  );
  return {
    pluginOutcome,
    bundledSkillRoots,
    pluginRuntimeFeatures,
    ownsSessionStore,
    sessionStore,
    localSettingStore,
    projectID,
    configuredMcpServers,
    runtimeConfig,
    untrustedProjectMcpServers,
  };
}
export type AppSessionConfiguration = Awaited<ReturnType<typeof resolveAppSessionConfiguration>>;
