// File Config Adapter - Load and patch JSON configuration files

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_CUA_PLUGIN_ID,
  LEGACY_CUA_PLUGIN_ID,
  parseConfigFileToRuntimePatchWithDiagnostics,
} from "./schema.js";
import {
  type FileConfigOptions,
  type LoadedConfig,
  resolvePath,
  DEFAULT_BASE_DIR,
  DEFAULT_CONFIG_FILE,
  persistPluginConfigMigration,
  attachDiagnosticFilePath,
  createConfigFileInvalidDiagnostic,
  isRecord,
} from "./file-config.adapter-loaded-config.js";

/**
 * Load configuration from a JSON file
 */
export function loadFileConfig(filePath?: string, options: FileConfigOptions = {}): LoadedConfig {
  const resolvedPath = filePath
    ? resolvePath(filePath)
    : join(
        resolvePath(options.baseDir ?? DEFAULT_BASE_DIR),
        options.configFileName ?? DEFAULT_CONFIG_FILE,
      );

  if (!existsSync(resolvedPath)) {
    return {
      config: {},
      diagnostics: [],
      path: resolvedPath,
      loaded: false,
    };
  }

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(content);
    const migrated = migratePluginConfigInFile(parsed);
    if (migrated) {
      // 仅装载态归一化会让旧 key 永久留在磁盘，后续版本无法安全删除迁移逻辑。
      persistPluginConfigMigration(resolvedPath, migrated);
    }
    const result = parseConfigFileToRuntimePatchWithDiagnostics(parsed);

    return {
      config: result.config,
      diagnostics: attachDiagnosticFilePath(result.diagnostics, resolvedPath),
      path: resolvedPath,
      loaded: true,
    };
  } catch (error) {
    return {
      config: {},
      diagnostics: [createConfigFileInvalidDiagnostic(error, resolvedPath)],
      path: resolvedPath,
      loaded: false,
    };
  }
}

function migratePluginConfigInFile(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.plugins)) return undefined;
  const plugins = value.plugins;
  const nextPlugins = { ...plugins };
  let changed = false;

  if (isRecord(plugins.enabledPlugins)) {
    const enabledPlugins = { ...plugins.enabledPlugins };
    for (const [id, enabled] of Object.entries(plugins.enabledPlugins)) {
      if (id === LEGACY_CUA_PLUGIN_ID) {
        const canonicalId = CANONICAL_CUA_PLUGIN_ID;
        if (enabledPlugins[canonicalId] === undefined) enabledPlugins[canonicalId] = enabled;
        delete enabledPlugins[id];
        changed = true;
      }
    }
    if (changed) nextPlugins.enabledPlugins = enabledPlugins;
  }

  if (Array.isArray(plugins.suppressedBuiltins)) {
    const suppressedBuiltins = plugins.suppressedBuiltins.map((id) =>
      id === LEGACY_CUA_PLUGIN_ID ? CANONICAL_CUA_PLUGIN_ID : id,
    );
    if (JSON.stringify(suppressedBuiltins) !== JSON.stringify(plugins.suppressedBuiltins)) {
      nextPlugins.suppressedBuiltins = suppressedBuiltins;
      changed = true;
    }
  }

  if (isRecord(plugins.options)) {
    const options = { ...plugins.options };
    for (const [id, pluginOptions] of Object.entries(plugins.options)) {
      if (id === LEGACY_CUA_PLUGIN_ID) {
        const canonicalId = CANONICAL_CUA_PLUGIN_ID;
        if (options[canonicalId] === undefined) options[canonicalId] = pluginOptions;
        delete options[id];
        changed = true;
      }
    }
    if (changed) nextPlugins.options = options;
  }

  return changed ? { ...value, plugins: nextPlugins } : undefined;
}

export type { LoadedConfig } from "./file-config.adapter-loaded-config.js";
export type { UiLocalePatchResult } from "./file-config.adapter-loaded-config.js";
export type { PluginEnabledPatchResult } from "./file-config.adapter-loaded-config.js";
export type { PluginOptionsPatchResult } from "./file-config.adapter-loaded-config.js";
export type { PluginRemovePatchResult } from "./file-config.adapter-loaded-config.js";
export { resolvePath } from "./file-config.adapter-loaded-config.js";
export { updateUiLocaleInFileConfig } from "./file-config.adapter-loaded-config.js";
export { updatePluginEnabledInFileConfig } from "./file-config.adapter-loaded-config.js";
export { enablePluginsByDefaultInFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { updatePluginOptionsInFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { removePluginFromFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { removePluginEnabledFromFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export type { SuppressedBuiltinPatchResult } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { addSuppressedBuiltinInFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { removeSuppressedBuiltinInFileConfig } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { getDefaultConfigPath } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
export { hasDefaultConfigFile } from "./file-config.adapter-enable-plugins-by-default-in-file-config.js";
