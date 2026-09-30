import { join } from "node:path";
import { directoryExists, isRecord, resolveInside, sanitizePluginId } from "./helpers.js";
import { recoverAtomicTargetSync } from "./atomic-directory.js";
import {
  type KnownMarketplaceRecord,
  throwIfPluginOperationAborted,
  type InstalledPluginsState,
  readJsonFileSync,
  INSTALLED_PLUGINS_FILE,
  type InstalledPluginRecord,
  type PluginMarketplaceManifest,
  type MarketplaceRefreshFailure,
  DEFAULT_VERSION,
} from "./marketplace-marketplace-source.js";
import {
  ensureDefaultPluginMarketplaces,
  loadKnownMarketplacesSync,
} from "./marketplace-load-known-marketplaces-sync.js";
import {
  loadMarketplaceManifestSync,
  writeJsonFile,
} from "./marketplace-load-marketplace-manifest-sync.js";
import {
  upsertKnownMarketplace,
  addMarketplace,
  toValidationDiagnostic,
} from "./marketplace-ensure-marketplace-manifest-available.js";
import { writeKnownMarketplaces } from "./marketplace-load-marketplace-from-source.js";

export async function updateMarketplace(input: {
  marketplace?: string;
  signal?: AbortSignal;
  storageRoot: string;
}): Promise<KnownMarketplaceRecord[]> {
  ensureDefaultPluginMarketplaces(input.storageRoot);
  const known = loadKnownMarketplacesSync(input.storageRoot);
  const selected = input.marketplace
    ? known.filter((record) => record.id === input.marketplace)
    : known;
  if (input.marketplace && selected.length === 0) {
    throw new Error(`Marketplace not found: ${input.marketplace}`);
  }
  const updated: KnownMarketplaceRecord[] = [];
  for (const record of selected) {
    throwIfPluginOperationAborted(input.signal);

    // 内置目录读本地 seed；个人来源按已登记 source 刷新。
    try {
      if (record.source.source === "bundled") {
        const manifest = loadMarketplaceManifestSync(input.storageRoot, record.id);
        if (!manifest) throw new Error(`Bundled marketplace is unavailable: ${record.id}`);
        const current: KnownMarketplaceRecord = {
          ...record,
          lastUpdated: new Date().toISOString(),
          pluginCount: manifest.plugins.length,
        };
        const activation = await upsertKnownMarketplace(input.storageRoot, current);
        activation.finalize();
        updated.push(current);
        continue;
      }
      updated.push(
        await addMarketplace({
          signal: input.signal,
          source: record.source,
          storageRoot: input.storageRoot,
        }),
      );
    } catch (error) {
      // 取消是当前 operation 的控制流，不是 Marketplace 健康状态；不得把 AbortError
      // 持久化成 refresh failure，避免后续普通商店页面误报官方源故障。
      if (input.signal?.aborted) throw error;
      const diagnostic = toValidationDiagnostic(error, record.id);
      await persistMarketplaceRefreshFailure(input.storageRoot, record.id, {
        code: diagnostic.code,
        failedAt: new Date().toISOString(),
        message: diagnostic.message,
      });
    }
  }
  return updated;
}

export async function removeMarketplace(input: {
  marketplace: string;
  storageRoot: string;
}): Promise<void> {
  const known = loadKnownMarketplacesSync(input.storageRoot).filter(
    (record) => record.id !== input.marketplace,
  );
  await writeKnownMarketplaces(input.storageRoot, known);
}

export function loadInstalledPluginsSync(storageRoot: string): InstalledPluginsState {
  const parsed = readJsonFileSync(join(storageRoot, INSTALLED_PLUGINS_FILE));
  return normalizeInstalledPluginsState(parsed);
}

export async function saveInstalledPlugins(
  storageRoot: string,
  state: InstalledPluginsState,
): Promise<void> {
  await writeJsonFile(join(storageRoot, INSTALLED_PLUGINS_FILE), state);
}

export function listInstalledPluginRecords(storageRoot: string): InstalledPluginRecord[] {
  return loadInstalledPluginsSync(storageRoot).plugins;
}

export function resolveInstalledPluginRoot(
  storageRoot: string,
  record: InstalledPluginRecord,
): string {
  const root =
    record.installPath ||
    getPluginCacheDir(storageRoot, record.marketplace, record.name, record.version);
  return recoverAtomicTargetSync(root);
}

export function resolveDependencyClosure(input: {
  allowCrossMarketplaces: ReadonlySet<string>;
  marketplace: string;
  name: string;
  storageRoot: string;
}): string[] {
  const rootId = `${input.name}@${input.marketplace}`;
  const closure: string[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  const walk = (pluginId: string, requiredBy: string): void => {
    const { marketplace, name } = parsePluginId(pluginId);
    if (marketplace !== input.marketplace && !input.allowCrossMarketplaces.has(marketplace)) {
      throw new Error(
        `Cross-marketplace dependency is blocked: ${pluginId} required by ${requiredBy}`,
      );
    }
    if (visiting.includes(pluginId)) {
      throw new Error(`Plugin dependency cycle: ${[...visiting, pluginId].join(" -> ")}`);
    }
    if (visited.has(pluginId)) return;
    const manifest = loadMarketplaceManifestSync(input.storageRoot, marketplace);
    if (!manifest) throw new Error(`Marketplace not found for dependency: ${marketplace}`);
    const entry = manifest.plugins.find((plugin) => plugin.name === name);
    if (!entry) throw new Error(`Dependency not found: ${pluginId} required by ${requiredBy}`);
    visiting.push(pluginId);
    for (const dependency of entry.dependencies ?? []) {
      walk(qualifyDependency(dependency, marketplace), pluginId);
    }
    visiting.pop();
    visited.add(pluginId);
    closure.push(pluginId);
  };

  walk(rootId, rootId);
  return closure;
}

export function resolveMarketplacePluginBaseDir(
  marketplaceDir: string,
  manifest: PluginMarketplaceManifest | null,
): string {
  const pluginRoot = manifest?.pluginRoot;
  if (!pluginRoot) return marketplaceDir;
  const resolved = resolveInside(marketplaceDir, pluginRoot);
  return resolved && directoryExists(resolved) ? resolved : marketplaceDir;
}

export async function persistMarketplaceRefreshFailure(
  storageRoot: string,
  marketplace: string,
  failure: MarketplaceRefreshFailure,
): Promise<void> {
  const known = loadKnownMarketplacesSync(storageRoot);
  const index = known.findIndex((record) => record.id === marketplace);
  if (index < 0 || !known[index]) return;
  known[index] = { ...known[index], lastRefreshFailure: failure };
  await writeKnownMarketplaces(storageRoot, known);
}

export function normalizeInstalledPluginsState(value: unknown): InstalledPluginsState {
  if (!isRecord(value)) return { version: 1, plugins: [] };
  const rawPlugins = value.plugins;
  if (isRecord(rawPlugins)) {
    return {
      version: 1,
      plugins: Object.entries(rawPlugins).flatMap(([pluginId, entry]) =>
        normalizeInstalledPluginRecordFromMap(pluginId, entry),
      ),
    };
  }
  const plugins = Array.isArray(rawPlugins) ? rawPlugins : [];
  return {
    version: 1,
    plugins: plugins.filter(isInstalledPluginRecord),
  };
}

export function normalizeInstalledPluginRecordFromMap(
  pluginId: string,
  entry: unknown,
): InstalledPluginRecord[] {
  const entries = Array.isArray(entry) ? entry : [entry];
  return entries.flatMap((item): InstalledPluginRecord[] => {
    if (!isRecord(item)) return [];
    const installPath = typeof item.installPath === "string" ? item.installPath : "";
    if (!installPath) return [];
    let parsed: { marketplace: string; name: string };
    try {
      parsed = parsePluginId(pluginId);
    } catch {
      return [];
    }
    const scope = item.scope === "project" || item.scope === "local" ? "workspace" : "user";
    return [
      {
        id: pluginId,
        name: parsed.name,
        marketplace: parsed.marketplace,
        version: typeof item.version === "string" ? item.version : DEFAULT_VERSION,
        installPath,
        installedAt:
          typeof item.installedAt === "string" ? item.installedAt : new Date(0).toISOString(),
        ...(typeof item.lastUpdated === "string" ? { updatedAt: item.lastUpdated } : {}),
        scope,
      },
    ];
  });
}

export function getPluginCacheDir(
  storageRoot: string,
  marketplace: string,
  name: string,
  version: string,
): string {
  return join(
    storageRoot,
    "cache",
    sanitizePluginId(marketplace),
    sanitizePluginId(name),
    sanitizePluginId(version),
  );
}

export function isInstalledPluginRecord(value: unknown): value is InstalledPluginRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.marketplace === "string" &&
    typeof value.version === "string" &&
    typeof value.installPath === "string" &&
    typeof value.installedAt === "string" &&
    (value.scope === "user" || value.scope === "workspace")
  );
}

export function parsePluginId(pluginId: string): { marketplace: string; name: string } {
  const at = pluginId.lastIndexOf("@");
  if (at <= 0 || at === pluginId.length - 1) {
    throw new Error(`Plugin id must use <name>@<marketplace>: ${pluginId}`);
  }
  return {
    name: pluginId.slice(0, at),
    marketplace: pluginId.slice(at + 1),
  };
}

export function qualifyDependency(dependency: string, marketplace: string): string {
  return dependency.includes("@") ? dependency : `${dependency}@${marketplace}`;
}
