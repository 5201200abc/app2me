import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginDiagnostic, PluginManifest, PluginOptionValues } from "@mycode/contracts";
import type { LoadedPlugin } from "./types.js";
import { isNotFoundError, isPluginOptionValue, isRecord, resolveInside } from "./helpers.js";

export const SUPPORTED_MCP_TYPES = new Set(["stdio", "http", "sse"]);

export const TEMPLATE_PATTERN = /\$\{([^}]+)\}/g;

export const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadPluginMcpServerDefinitions(input: {
  diagnostics: PluginDiagnostic[];
  loaded: LoadedPlugin;
}): Record<string, unknown> {
  const fromFile = loadMcpServersFromFile(join(input.loaded.rootPath, ".mcp.json"), input);
  const fromManifest = loadMcpServersFromSpec(input.loaded.manifest.mcpServers, input);
  return { ...fromFile, ...fromManifest };
}

export function toNamespacedServerName(loaded: LoadedPlugin, serverName: string): string {
  return `plugin:${loaded.manifest.name}:${serverName}`;
}

export function loadMcpServersFromSpec(
  spec: unknown,
  input: {
    diagnostics: PluginDiagnostic[];
    loaded: LoadedPlugin;
  },
): Record<string, unknown> {
  if (spec === undefined) return {};
  if (typeof spec === "string") {
    const path = resolveInside(input.loaded.rootPath, spec);
    if (!path) {
      input.diagnostics.push({
        code: "plugin_component_path_invalid",
        message: `Plugin mcpServers path escapes plugin root: ${spec}`,
        path: input.loaded.manifestPath,
        pluginId: input.loaded.id,
        severity: "error",
      });
      return {};
    }
    return loadMcpServersFromFile(path, input);
  }
  if (Array.isArray(spec)) {
    return Object.assign({}, ...spec.map((item) => loadMcpServersFromSpec(item, input)));
  }
  return normalizeMcpServersShape(spec, input);
}

export function loadMcpServersFromFile(
  path: string,
  input: {
    diagnostics: PluginDiagnostic[];
    loaded: LoadedPlugin;
  },
): Record<string, unknown> {
  try {
    return normalizeMcpServersShape(JSON.parse(readFileSync(path, "utf8")), input);
  } catch (error) {
    if (isNotFoundError(error)) return {};
    input.diagnostics.push({
      code: "plugin_mcp_read_failed",
      message: error instanceof Error ? error.message : `Failed to read MCP config: ${path}`,
      path,
      pluginId: input.loaded.id,
      severity: "error",
    });
    return {};
  }
}

export function normalizeMcpServersShape(
  value: unknown,
  input: {
    diagnostics: PluginDiagnostic[];
    loaded: LoadedPlugin;
  },
): Record<string, unknown> {
  if (!isRecord(value)) {
    input.diagnostics.push({
      code: "plugin_mcp_invalid",
      message: "Plugin MCP config must be an object",
      path: input.loaded.manifestPath,
      pluginId: input.loaded.id,
      severity: "error",
    });
    return {};
  }
  const servers = isRecord(value.mcpServers) ? value.mcpServers : value;
  return Object.fromEntries(Object.entries(servers).filter(([, config]) => isRecord(config)));
}

export interface VariableContext {
  dataPath: string;
  env: Record<string, string | undefined>;
  loaded: LoadedPlugin;
  options: PluginOptionValues;
  userConfigDefaults: PluginOptionValues;
  workingDirectory: string;
}

export function createVariableContext(input: {
  dataPath: string;
  env: Record<string, string | undefined>;
  loaded: LoadedPlugin;
  options: PluginOptionValues;
  workingDirectory: string;
}): VariableContext {
  return {
    dataPath: input.dataPath,
    env: input.env,
    loaded: input.loaded,
    options: input.options,
    userConfigDefaults: getUserConfigDefaults(input.loaded.manifest),
    workingDirectory: input.workingDirectory,
  };
}

export function getUserConfigDefaults(manifest: PluginManifest): PluginOptionValues {
  const defaults: PluginOptionValues = {};
  for (const [key, option] of Object.entries(manifest.userConfig ?? {})) {
    if (isPluginOptionValue(option.default)) defaults[key] = option.default;
  }
  return defaults;
}

export function inferMcpType(server: Record<string, unknown>): string {
  return typeof server.command === "string" ? "stdio" : "http";
}

export function requireString(value: unknown, message: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(message);
}

export function resolveStringRecord(
  record: Record<string, unknown>,
  context: VariableContext,
  options: { allowSensitive: boolean },
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") result[key] = resolveTemplate(value, context, options);
  }
  return result;
}

export function resolveTemplate(
  value: string,
  context: VariableContext,
  options: { allowSensitive: boolean },
): string {
  return value.replace(TEMPLATE_PATTERN, (match, name: string) => {
    switch (name) {
      case "CLAUDE_PLUGIN_ROOT":
      case "MYCODE_PLUGIN_ROOT":
        return context.loaded.rootPath;
      case "CLAUDE_PLUGIN_DATA":
      case "MYCODE_PLUGIN_DATA":
        return context.dataPath;
      case "CLAUDE_PROJECT_DIR":
      case "MYCODE_PROJECT_DIR":
        return context.workingDirectory;
      case "CLAUDE_CODE_SESSION_ID":
      case "CLAUDE_SESSION_ID":
      case "MYCODE_SESSION_ID":
        throw new PluginVariableError(
          `Plugin variable requires a runtime session context: ${name}`,
        );
      case "CLAUDE_SKILL_DIR":
      case "MYCODE_SKILL_DIR":
        throw new PluginVariableError(`Plugin variable requires a skill context: ${name}`);
      default:
        break;
    }

    if (name.startsWith("user_config.")) {
      const key = name.slice("user_config.".length);
      if (
        context.loaded.manifest.userConfig?.[key]?.sensitive === true &&
        !options.allowSensitive
      ) {
        throw new PluginVariableError(
          `Sensitive plugin user_config value cannot be used in this field: ${key}`,
        );
      }
      const configValue = context.options[key] ?? context.userConfigDefaults[key];
      if (configValue === undefined) {
        throw new PluginVariableError(`Missing plugin user_config value: ${key}`);
      }
      return String(configValue);
    }
    if (name.startsWith("MYCODE_")) {
      const envValue = context.env[name];
      if (envValue === undefined)
        throw new PluginVariableError(`Missing environment variable: ${name}`);
      return envValue;
    }
    if (options.allowSensitive && ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name)) {
      // token。只在敏感 sink 解析，避免 secret 被展开到 args、URL 或其它可见字段。
      const envValue = context.env[name];
      if (envValue === undefined)
        throw new PluginVariableError(`Missing environment variable: ${name}`);
      return envValue;
    }

    return match;
  });
}

export class PluginVariableError extends Error {}
