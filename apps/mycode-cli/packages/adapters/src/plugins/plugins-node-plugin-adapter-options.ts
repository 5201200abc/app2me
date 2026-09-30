import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  HookConfig,
  HookEventName,
  HookMatcherConfig,
  HookPluginContext,
  PluginConfig,
  PluginDiagnostic,
  PluginHookDetail,
  PluginLoadOutcome,
  PluginManifest,
} from "@mycode/contracts";
import { HookEventName as HookEventNameValue } from "@mycode/contracts";
import { directoryExists, fileExists, isRecord } from "./helpers.js";
import type { LoadedPlugin, PluginCandidate } from "./types.js";

export const MYCODE_MANIFEST_PATH = join(".mycode-plugin", "plugin.json");

export const CLAUDE_MANIFEST_PATH = join(".claude-plugin", "plugin.json");

export const CODEX_MANIFEST_PATH = join(".codex-plugin", "plugin.json");

export const DEFAULT_VERSION = "0.0.0";

export const FIRST_PLUGIN_PRIORITY = 1_000;

export const PRIORITY_STEP = 10;

export const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const UNSUPPORTED_COMPONENT_KEYS = [
  "channels",
  "lspServers",
  "outputStyles",
  "settings",
] as const;

export const SUPPORTED_HOOK_EVENTS = new Set<string>(Object.values(HookEventNameValue));

export interface PluginHookInspection {
  details: PluginHookDetail[];
  events: Partial<Record<HookEventName, HookMatcherConfig[]>>;
}

export interface NodePluginAdapterOptions {
  storageRoot: string;
}

export function canRunPluginHooks(_loaded: LoadedPlugin): boolean {
  // 三方 marketplace 插件 hook 默认放行（与内置/官方一致）。
  // 上限：放弃了「仅官方可执行 hook」的信任边界，三方插件 hook 会直接执行；
  // 升级路径：需要逐插件 trust（如 user config 白名单）时，把判断收回这里。
  return true;
}

export function warnUnsupportedComponents(
  loaded: LoadedPlugin,
  diagnostics: PluginDiagnostic[],
): void {
  for (const key of UNSUPPORTED_COMPONENT_KEYS) {
    if (key in loaded.manifest) {
      diagnostics.push({
        code: "plugin_unsupported_component",
        message: `Plugin component is diagnostic-only in this MyCode runtime: ${key}`,
        path: loaded.manifestPath,
        pluginId: loaded.id,
        severity: "warning",
      });
    }
  }
}

export function toPluginHookDetail(input: {
  event: HookEventName;
  hook: HookConfig;
  matcher?: string;
  runnable: boolean;
  sourcePath: string;
}): PluginHookDetail {
  const detail: PluginHookDetail = {
    command: input.hook.command,
    event: input.event,
    runnable: input.runnable,
    sourcePath: input.sourcePath,
    type: input.hook.type,
  };
  if (input.matcher !== undefined) detail.matcher = input.matcher;
  if (input.hook.statusMessage !== undefined) detail.statusMessage = input.hook.statusMessage;
  if (input.hook.timeoutMs !== undefined) detail.timeoutMs = input.hook.timeoutMs;
  if (input.hook.type === "process") {
    if (input.hook.args !== undefined) detail.args = input.hook.args;
    return detail;
  }
  if (input.hook.async !== undefined) detail.async = input.hook.async;
  if (input.hook.shell !== undefined) detail.shell = input.hook.shell;
  if (input.hook.timeout !== undefined) detail.timeout = input.hook.timeout;
  return detail;
}

export function createHookPluginContext(
  loaded: LoadedPlugin,
  dataPath: string,
  sourcePath?: string,
): HookPluginContext {
  return {
    dataPath,
    id: loaded.id,
    name: loaded.manifest.name,
    rootPath: loaded.rootPath,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

export function attachPluginToHook(hook: HookConfig, plugin: HookPluginContext): HookConfig {
  return {
    ...hook,
    plugin,
  };
}

export function emptyHookInspection(): PluginHookInspection {
  return {
    details: [],
    events: {},
  };
}

export function loadPlugin(
  candidate: PluginCandidate,
  diagnostics: PluginDiagnostic[],
): LoadedPlugin | null {
  if (!directoryExists(candidate.rootPath)) {
    diagnostics.push({
      code: "plugin_root_not_found",
      message: `Plugin root does not exist: ${candidate.rootPath}`,
      path: candidate.rootPath,
      severity: "warning",
    });
    return null;
  }

  const manifestPath = findManifest(candidate.rootPath);
  if (!manifestPath) {
    diagnostics.push({
      code: "plugin_manifest_not_found",
      message: `Plugin manifest not found: ${candidate.rootPath}`,
      path: candidate.rootPath,
      severity: "error",
    });
    return null;
  }

  const manifest = readManifest(manifestPath, diagnostics);
  if (!manifest) return null;
  return {
    id: `${manifest.name}@${candidate.marketplace}`,
    manifest,
    manifestPath,
    marketplace: candidate.marketplace,
    rootPath: candidate.rootPath,
    source: candidate.source,
  };
}

export function findManifest(rootPath: string): string | null {
  const mycodePath = join(rootPath, MYCODE_MANIFEST_PATH);
  if (fileExists(mycodePath)) {
    return mycodePath;
  }

  // 兼容不同 manifest 目录约定，发现阶段按稳定优先级回退。
  const claudePath = join(rootPath, CLAUDE_MANIFEST_PATH);
  if (fileExists(claudePath)) {
    return claudePath;
  }
  const codexPath = join(rootPath, CODEX_MANIFEST_PATH);
  return fileExists(codexPath) ? codexPath : null;
}

export function readManifest(path: string, diagnostics: PluginDiagnostic[]): PluginManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("Manifest must be a JSON object");
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!PLUGIN_NAME_PATTERN.test(name)) throw new Error(`Invalid plugin name: ${name}`);
    return {
      ...parsed,
      name,
      version: typeof parsed.version === "string" ? parsed.version : DEFAULT_VERSION,
    } as PluginManifest;
  } catch (error) {
    diagnostics.push({
      code: "plugin_manifest_invalid",
      message: error instanceof Error ? error.message : `Invalid plugin manifest: ${path}`,
      path,
      severity: "error",
    });
    return null;
  }
}

export function emptyOutcome(): PluginLoadOutcome {
  return {
    commandRoots: [],
    diagnostics: [],
    hooks: {},
    mcpServers: {},
    plugins: [],
    skillRoots: [],
  };
}

export function resolveEnabled(config: PluginConfig, id: string, defaultEnabled: boolean): boolean {
  return config.enabledPlugins[id] ?? defaultEnabled;
}
