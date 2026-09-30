import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RuntimeConfigPatch, UiLocale } from "@mycode/contracts";
import { z } from "zod";
import { canonicalizePluginId, pluginIdAliases, type ConfigDiagnostic } from "./schema.js";

export interface FileConfigOptions {
  baseDir?: string;
  configFileName?: string;
}

export interface LoadedConfig {
  config: RuntimeConfigPatch;
  diagnostics: ConfigDiagnostic[];
  path: string;
  loaded: boolean;
}

export interface UiLocalePatchResult {
  locale: UiLocale;
  path: string;
}

export interface PluginEnabledPatchResult {
  enabled: boolean;
  path: string;
  pluginId: string;
}

export interface PluginOptionsPatchResult {
  clearedOptionKeys: string[];
  options: Record<string, string | number | boolean>;
  path: string;
  pluginId: string;
}

export interface PluginRemovePatchResult {
  path: string;
  pluginId: string;
  removedEnabled: boolean;
  removedOptions: boolean;
}

export const DEFAULT_CONFIG_FILE = "config.json";

export const DEFAULT_BASE_DIR = "~/.mycode/cli";

/**
 * Resolve path with ~ expansion
 */
export function resolvePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return resolve(path);
}

export function persistPluginConfigMigration(
  filePath: string,
  value: Record<string, unknown>,
): void {
  const tempPath = `${filePath}.migrate.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    renameSync(tempPath, filePath);
  } catch {
    // 迁移写回是 best-effort 副作用，失败不能改变合法配置的装载语义。
    try {
      unlinkSync(tempPath);
    } catch {
      // 临时文件清理失败不影响当前配置装载。
    }
  }
}

export function createConfigFileInvalidDiagnostic(
  error: unknown,
  filePath: string,
): ConfigDiagnostic {
  return {
    code: "config_file_invalid",
    filePath,
    message:
      error instanceof z.ZodError
        ? formatZodError(error)
        : error instanceof Error
          ? error.message
          : "Unable to parse config file.",
    severity: "error",
  };
}

export function attachDiagnosticFilePath(
  diagnostics: ConfigDiagnostic[],
  filePath: string,
): ConfigDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    filePath: diagnostic.filePath ?? filePath,
  }));
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<config>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Patch only the UI locale selection in a JSON config file.
 */
export async function updateUiLocaleInFileConfig(
  filePath: string,
  locale: UiLocale,
): Promise<UiLocalePatchResult> {
  const resolvedPath = resolvePath(filePath);
  const parsed = await readJsonConfigFileOrEmpty(resolvedPath);
  const next = patchUiLocale(parsed, locale);

  await atomicWriteJson(resolvedPath, next);
  return {
    locale,
    path: resolvedPath,
  };
}

/**
 * Patch the user plugin enabled map without touching plugin installation state.
 */
export async function updatePluginEnabledInFileConfig(
  filePath: string,
  pluginId: string,
  enabled: boolean,
): Promise<PluginEnabledPatchResult> {
  const resolvedPath = resolvePath(filePath);
  const parsed = await readJsonConfigFileOrEmpty(resolvedPath);
  const next = patchPluginEnabled(parsed, pluginId, enabled);

  await atomicWriteJson(resolvedPath, next);
  return {
    enabled,
    path: resolvedPath,
    pluginId,
  };
}

export async function readJsonConfigFile(filePath: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error) {
    throw new Error(`Unable to read config file: ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Unable to parse config file as JSON: ${filePath}`, { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${filePath}`);
  }

  return parsed;
}

export async function readJsonConfigFileOrEmpty(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    return await readJsonConfigFile(filePath);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (isNodeError(cause) && cause.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function patchUiLocale(
  parsed: Record<string, unknown>,
  locale: UiLocale,
): Record<string, unknown> {
  const currentUi = isRecord(parsed.ui) ? parsed.ui : {};

  return {
    ...parsed,
    ui: {
      ...currentUi,
      locale,
    },
  };
}

export function patchPluginEnabled(
  parsed: Record<string, unknown>,
  pluginId: string,
  enabled: boolean,
): Record<string, unknown> {
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const enabledPlugins = isRecord(plugins.enabledPlugins) ? plugins.enabledPlugins : {};
  const canonicalPluginId = canonicalizePluginId(pluginId);
  const nextEnabledPlugins = { ...enabledPlugins };
  for (const id of pluginIdAliases(canonicalPluginId)) delete nextEnabledPlugins[id];

  return {
    ...parsed,
    plugins: {
      ...plugins,
      enabledPlugins: {
        ...nextEnabledPlugins,
        [canonicalPluginId]: enabled,
      },
    },
  };
}

export async function atomicWriteJson(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await writeFile(tempPath, content, { mode: 0o600 });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error(`Unable to write config file: ${filePath}`, { cause: error });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
