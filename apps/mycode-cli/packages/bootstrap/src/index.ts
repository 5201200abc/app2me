// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListMyCodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunMyCodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  MyCodeApp,
  MyCodeAppOptions,
  MyCodeModelOption,
} from "./app/types.js";
export {
  inspectMyCodeCustomCommand,
  listMyCodeCustomCommands,
  loadMyCodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectMyCodeCustomCommandOptions,
  ListMyCodeCustomCommandsOptions,
  MyCodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addMyCodePluginMarketplace,
  getMyCodePluginsOverview,
  installMyCodeMarketplacePlugin,
  listMyCodePlugins,
  removeMyCodePluginMarketplace,
  resolveMyCodePlugins,
  setMyCodePluginEnabled,
  uninstallMyCodeMarketplacePlugin,
  updateMyCodeMarketplacePlugin,
  updateMyCodePluginMarketplace,
  validateMyCodePluginPath,
} from "./plugins.js";
export type {
  AddMyCodeMarketplaceOptions,
  InstallMyCodeMarketplacePluginOptions,
  ListMyCodePluginsOptions,
  RemoveMyCodeMarketplaceOptions,
  ResolveMyCodePluginsOptions,
  SetMyCodePluginEnabledOptions,
  SetMyCodePluginEnabledResult,
  UninstallMyCodeMarketplacePluginOptions,
  UpdateMyCodeMarketplaceOptions,
  UpdateMyCodeMarketplacePluginOptions,
  ValidateMyCodePluginPathOptions,
  MyCodeAvailablePluginData,
  MyCodeInstalledPluginData,
  MyCodeMarketplaceSummaryData,
  MyCodeMarketplaceUpdateData,
  MyCodePluginInstallData,
  MyCodePluginUpdateData,
  MyCodePluginsOverviewData,
} from "./plugins.js";
export { runMyCodeProtocolAgent } from "./mycode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./mycode-protocol/session-mapper.js";
export { prepareMyCodeTelemetryEnv, shutdownMyCodeTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listMyCodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectMyCodeSkill, listMyCodeSkills } from "./skills.js";
export type {
  InspectMyCodeSkillOptions,
  ListMyCodeSkillsOptions,
  MyCodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedMyCodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
