import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginDiagnostic } from "@mycode/contracts";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@mycode/contracts";
import { isNotFoundError, throwIfAborted } from "./helpers.js";
import { loadBundledOfficialPluginRootsSync } from "./official-marketplace.js";
import type { PluginAbortOptions } from "./types.js";

export function scanOfficialCache(
  storageRoot: string,
  diagnostics: PluginDiagnostic[],
  options?: PluginAbortOptions,
): string[] {
  // 官方插件升级会保留旧版本缓存目录；若遍历全部目录再按插件 id
  // “先到先得”，旧版本会抢在 bundled marketplace 指向的当前版本前被加载。
  // bundled 分片是当前随应用发布资产的权威清单；存在时只加载其 cachePath。
  // 不能简单选择最高 semver，否则官方回滚版本时仍会错误加载旧缓存。
  const bundledRoots = loadBundledOfficialPluginRootsSync(storageRoot);
  if (bundledRoots !== undefined) {
    for (const rootPath of bundledRoots) {
      throwIfAborted(options);
    }
    return bundledRoots;
  }

  const cacheRoot = join(storageRoot, "cache", MYCODE_OFFICIAL_PLUGIN_MARKETPLACE);
  try {
    const roots: string[] = [];
    for (const pluginEntry of readdirSync(cacheRoot, { withFileTypes: true })) {
      throwIfAborted(options);
      if (!pluginEntry.isDirectory()) continue;
      const pluginDir = join(cacheRoot, pluginEntry.name);
      for (const versionEntry of readdirSync(pluginDir, { withFileTypes: true })) {
        if (versionEntry.isDirectory()) roots.push(join(pluginDir, versionEntry.name));
      }
    }
    return roots;
  } catch (error) {
    if (isNotFoundError(error)) return [];
    diagnostics.push({
      code: "plugin_root_not_found",
      message: error instanceof Error ? error.message : `Failed to scan ${cacheRoot}`,
      path: cacheRoot,
      severity: "warning",
    });
    return [];
  }
}
