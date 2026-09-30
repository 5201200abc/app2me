import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@mycode/tui";
import type { UiLocale } from "@mycode/i18n";
import type { Logger } from "@mycode/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@mycode/adapters/browser";
import type {
  createModelAdapter,
  createMyCodeApp,
  CreateModelAdapterOptions,
  inspectMyCodeSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectMyCodeCustomCommand,
  InspectMyCodeCustomCommandOptions,
  InspectMyCodeSkillOptions,
  listMyCodeCustomCommands,
  ListMyCodeCustomCommandsOptions,
  loadMyCodeCustomCommand,
  listMyCodeSessions,
  listMyCodeSkills,
  ListMyCodeSessionsOptions,
  ListMyCodeSkillsOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunMyCodeProtocolAgentOptions,
  prepareMyCodeTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownMyCodeTelemetry,
  MyCodeAppOptions,
} from "@mycode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@mycode/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunMyCodeProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createMyCodeApp?: (
    options?: MyCodeAppOptions,
  ) => Awaited<ReturnType<typeof createMyCodeApp>> | ReturnType<typeof createMyCodeApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createMyCodeApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectMyCodeSkillOptions) => ReturnType<typeof inspectMyCodeSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectMyCodeCustomCommandOptions,
  ) => ReturnType<typeof inspectMyCodeCustomCommand>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareMyCodeTelemetryEnv?: typeof prepareMyCodeTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListMyCodeSessionsOptions) => ReturnType<typeof listMyCodeSessions>;
  listCustomCommands?: (
    options: ListMyCodeCustomCommandsOptions,
  ) => ReturnType<typeof listMyCodeCustomCommands>;
  loadCustomCommand?: (
    options: InspectMyCodeCustomCommandOptions,
  ) => ReturnType<typeof loadMyCodeCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedMyCodeSlashCommandName"];
  listSkills?: (options: ListMyCodeSkillsOptions) => ReturnType<typeof listMyCodeSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  runMyCodeProtocolAgent?: (options?: RunMyCodeProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@mycode/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownMyCodeTelemetry?: typeof shutdownMyCodeTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createMyCodeApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
