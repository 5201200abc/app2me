import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@mycode/provider";
import { NodeMyCodeBuiltinProviderConfigSource } from "./mycode-builtin-provider-config-source.js";
import {
  EndpointScopedMyCodeBuiltinSource,
  type EndpointScopedMyCodeBuiltinSourceOptions,
} from "./endpoint-scoped-mycode-builtin-source.js";
import {
  MyCodeBuiltinRemoteSynchronizer,
  type MyCodeBuiltinRemoteSynchronizerOptions,
  type MyCodeBuiltinRefreshResult,
} from "./mycode-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly mycodeBuiltinFilePath: string;
  readonly mycodeBuiltinActiveFilePath?: string;
  readonly mycodeBuiltinRemote?: Omit<MyCodeBuiltinRemoteSynchronizerOptions, "source">;
  readonly mycodeBuiltinEnvironment?: Omit<
    EndpointScopedMyCodeBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onMyCodeBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    mycodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 MyCode Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #mycodeBuiltinSource:
    | NodeMyCodeBuiltinProviderConfigSource
    | EndpointScopedMyCodeBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: MyCodeBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#mycodeBuiltinSource = options.mycodeBuiltinEnvironment
      ? new EndpointScopedMyCodeBuiltinSource({
          bundledFilePath: options.mycodeBuiltinFilePath,
          ...options.mycodeBuiltinEnvironment,
        })
      : new NodeMyCodeBuiltinProviderConfigSource({
          bundledFilePath: options.mycodeBuiltinFilePath,
          activeFilePath: options.mycodeBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.mycodeBuiltinRemote &&
      this.#mycodeBuiltinSource instanceof NodeMyCodeBuiltinProviderConfigSource
        ? new MyCodeBuiltinRemoteSynchronizer({
            source: this.#mycodeBuiltinSource,
            ...options.mycodeBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onMyCodeBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#mycodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      mycodeBuiltinSource: this.#mycodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveMyCodeBuiltinActiveFilePath(): Promise<string> {
    return this.#mycodeBuiltinSource instanceof NodeMyCodeBuiltinProviderConfigSource
      ? Promise.resolve(this.#mycodeBuiltinSource.activeFilePath)
      : this.#mycodeBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@mycode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckMyCodeBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#mycodeBuiltinSource instanceof EndpointScopedMyCodeBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshMyCodeBuiltin(options?: { readonly force?: boolean }): Promise<MyCodeBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#mycodeBuiltinSource instanceof EndpointScopedMyCodeBuiltinSource) {
      return this.#mycodeBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshMyCodeBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#mycodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
