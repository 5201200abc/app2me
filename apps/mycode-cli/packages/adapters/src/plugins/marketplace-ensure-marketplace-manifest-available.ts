import { isOfficialMarketplaceId } from "@mycode/contracts";
import { appendPluginSourceCleanupError, cleanupPluginSourceBestEffort } from "./helpers.js";
import { type AtomicDirectoryActivation } from "./atomic-directory.js";
import { getPluginSourceDiagnosticCode } from "./source-errors.js";
import {
  type KnownMarketplaceRecord,
  throwIfPluginOperationAborted,
  type MarketplaceSource,
  type LoadMarketplaceResult,
  type KnownMarketplaceActivation,
  type PluginValidationDiagnostic,
} from "./marketplace-marketplace-source.js";
import {
  ensureDefaultPluginMarketplaces,
  loadKnownMarketplacesSync,
} from "./marketplace-load-known-marketplaces-sync.js";
import {
  loadMarketplaceManifestSync,
  stageMarketplaceDirectoryPlugins,
} from "./marketplace-load-marketplace-manifest-sync.js";
import {
  loadMarketplaceFromSource,
  stageMarketplaceManifest,
  writeKnownMarketplaces,
  UnsupportedMarketplaceSourceError,
} from "./marketplace-load-marketplace-from-source.js";

export async function ensureMarketplaceManifestAvailable(input: {
  marketplace: string;
  signal?: AbortSignal;
  storageRoot: string;
}): Promise<KnownMarketplaceRecord | null> {
  throwIfPluginOperationAborted(input.signal);
  ensureDefaultPluginMarketplaces(input.storageRoot);
  if (loadMarketplaceManifestSync(input.storageRoot, input.marketplace)) {
    return (
      loadKnownMarketplacesSync(input.storageRoot).find(
        (record) => record.id === input.marketplace,
      ) ?? null
    );
  }
  const record = loadKnownMarketplacesSync(input.storageRoot).find(
    (item) => item.id === input.marketplace,
  );
  if (!record) return null;
  if (record.source.source === "bundled") return null;
  // 仅对个人来源按已登记 source 懒加载；内置目录由启动 seed 写入。
  return await addMarketplace({
    signal: input.signal,
    source: record.source,
    storageRoot: input.storageRoot,
  });
}

export async function addMarketplace(input: {
  expectedId?: string;
  signal?: AbortSignal;
  source: MarketplaceSource;
  storageRoot: string;
}): Promise<KnownMarketplaceRecord> {
  // persist:false 先只解析 manifest，不落盘——否则 marketplace 目录激活会用
  // 不可信 manifest.name 作为 target，先 rm 掉本地官方目录再 cp，等守卫抛错时
  // 官方 manifest 已被污染；守卫通过后才持久化。
  throwIfPluginOperationAborted(input.signal);
  const operationSignal = input.signal;
  let loaded: LoadMarketplaceResult | undefined;
  let knownMarketplaceActivation: KnownMarketplaceActivation | undefined;
  let marketplaceActivation: AtomicDirectoryActivation | undefined;
  try {
    loaded = await loadMarketplaceFromSource(input.source, input.storageRoot, {
      persist: false,
      signal: operationSignal,
    });
    throwIfPluginOperationAborted(operationSignal);
    if (isOfficialMarketplaceId(loaded.manifest.name)) {
      throw new Error(
        `Cannot add a marketplace named "${loaded.manifest.name}": that id is reserved for the official marketplace.`,
      );
    }
    if (input.expectedId && loaded.manifest.name !== input.expectedId) {
      throw new Error(
        `Marketplace declaration id mismatch: expected ${input.expectedId}, received ${loaded.manifest.name}`,
      );
    }
    const persistedManifest = loaded.manifest;
    // 旧流程先删 marketplace target 再复制 source，刷新失败会丢失最后成功快照。
    // source tree 与规范 manifest 在同一 staging 目录准备完毕后一次 rename 激活。
    if (loaded.sourceRoot) {
      marketplaceActivation = await stageMarketplaceDirectoryPlugins(
        loaded.sourceRoot,
        input.storageRoot,
        loaded.manifest.name,
        persistedManifest.raw,
        operationSignal,
      );
    } else {
      marketplaceActivation = await stageMarketplaceManifest(
        input.storageRoot,
        loaded.manifest.name,
        loaded.manifest.raw,
        operationSignal,
      );
    }
    throwIfPluginOperationAborted(operationSignal);
    const now = new Date().toISOString();
    const record: KnownMarketplaceRecord = {
      id: loaded.manifest.name,
      source: input.source,
      name: loaded.manifest.name,
      ...(loaded.manifest.description ? { description: loaded.manifest.description } : {}),
      addedAt: now,
      lastUpdated: now,
      pluginCount: persistedManifest.plugins.length,
      ...(marketplaceActivation ? { cacheTransactionId: marketplaceActivation.transactionId } : {}),
    };
    knownMarketplaceActivation = await upsertKnownMarketplace(input.storageRoot, record);
    if (marketplaceActivation) {
      throwIfPluginOperationAborted(operationSignal);
    }
    // authority state 已落盘后才进入不可取消的提交尾声，随后清理 backup/marker。
    await marketplaceActivation?.finalize();
    knownMarketplaceActivation.finalize();
    return record;
  } catch (error) {
    let rollbackError: unknown;
    try {
      await knownMarketplaceActivation?.rollback();
    } catch (currentRollbackError) {
      rollbackError = currentRollbackError;
    }
    try {
      if (rollbackError === undefined) {
        await marketplaceActivation?.rollback();
      } else {
        // authority 无法恢复时保留其指向的新 manifest，避免再次制造跨代状态。
        await marketplaceActivation?.finalize();
      }
    } catch (currentRollbackError) {
      rollbackError =
        rollbackError === undefined
          ? currentRollbackError
          : appendPluginSourceCleanupError(currentRollbackError, rollbackError);
    }
    throw appendPluginSourceCleanupError(error, rollbackError);
  } finally {
    await cleanupPluginSourceBestEffort(loaded?.cleanup);
  }
}

export async function upsertKnownMarketplace(
  storageRoot: string,
  record: KnownMarketplaceRecord,
): Promise<KnownMarketplaceActivation> {
  const known = loadKnownMarketplacesSync(storageRoot);
  const index = known.findIndex((item) => item.id === record.id);
  const previous = index >= 0 ? known[index] : undefined;
  if (index >= 0) {
    const {
      cacheTransactionId: _previousCacheTransactionId,
      lastRefreshFailure: _lastRefreshFailure,
      ...successfulPrevious
    } = previous ?? record;
    known[index] = {
      ...successfulPrevious,
      ...record,
      addedAt: previous?.addedAt ?? record.addedAt,
    };
  } else {
    known.push(record);
  }
  await writeKnownMarketplaces(storageRoot, known);
  let settled = false;
  return {
    finalize: () => {
      settled = true;
    },
    rollback: async () => {
      if (settled) return;
      const current = loadKnownMarketplacesSync(storageRoot);
      const currentIndex = current.findIndex((item) => item.id === record.id);
      const currentRecord = currentIndex >= 0 ? current[currentIndex] : undefined;
      if (
        !currentRecord ||
        currentRecord.lastUpdated !== record.lastUpdated ||
        currentRecord.cacheTransactionId !== record.cacheTransactionId
      ) {
        throw new Error(
          `Cannot roll back marketplace authority after concurrent update: ${record.id}`,
        );
      }
      if (previous) {
        current[currentIndex] = previous;
      } else {
        current.splice(currentIndex, 1);
      }
      await writeKnownMarketplaces(storageRoot, current);
      settled = true;
    },
  };
}

export function toValidationDiagnostic(
  error: unknown,
  pluginId?: string,
): PluginValidationDiagnostic {
  if (
    error instanceof UnsupportedMarketplaceSourceError ||
    error instanceof UnsupportedPluginSourceError
  ) {
    return {
      code: "plugin_marketplace_source_unsupported",
      message: error.message,
      ...(pluginId ? { pluginId } : {}),
      severity: "error",
    };
  }
  const sourceCode = getPluginSourceDiagnosticCode(error);
  if (sourceCode) {
    return {
      code: sourceCode,
      message: error instanceof Error ? error.message : String(error),
      ...(pluginId ? { pluginId } : {}),
      severity: "error",
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cross-marketplace dependency")) {
    return {
      code: "plugin_dependency_cross_marketplace",
      message,
      ...(pluginId ? { pluginId } : {}),
      severity: "error",
    };
  }
  if (message.includes("dependency cycle")) {
    return {
      code: "plugin_dependency_cycle",
      message,
      ...(pluginId ? { pluginId } : {}),
      severity: "error",
    };
  }
  if (
    message.includes("Dependency not found") ||
    message.includes("Marketplace not found for dependency")
  ) {
    return {
      code: "plugin_dependency_missing",
      message,
      ...(pluginId ? { pluginId } : {}),
      severity: "error",
    };
  }
  return {
    code: "plugin_marketplace_invalid",
    message,
    ...(pluginId ? { pluginId } : {}),
    severity: "error",
  };
}

export class UnsupportedPluginSourceError extends Error {
  constructor(source: string) {
    super(`Plugin source is recognized but not supported in this runtime: ${source}`);
  }
}
