import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  materializeMyCodeBuiltinProviderConfig,
  NodeMyCodeBuiltinProviderConfigSource,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
} from "@mycode/provider-node";
import type { CliEnv } from "./env.js";

export const SEA_MYCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY = "mycode-provider/mycode-builtin.json";

type SeaProviderConfigAssets = Pick<typeof import("node:sea"), "getAsset" | "isSea">;

interface PrepareCliProviderRuntimeEnvOptions {
  readonly argv: readonly string[];
  readonly env: CliEnv;
  readonly dataBaseDir?: string;
  readonly entrypoint?: string;
  readonly sea?: SeaProviderConfigAssets;
  readonly appVersion?: string;
  readonly platform?: string;
}

/** 为运行 Core 或写入模型选择的 CLI Entry 定位同一 Environment 的 Provider Config。 */
export async function prepareCliProviderRuntimeEnv(
  options: PrepareCliProviderRuntimeEnvOptions,
): Promise<Record<string, string>> {
  if (!requiresProviderRuntime(options.argv)) return {};

  const explicitMyCodeBuiltin = options.env[MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const explicitPersonal = options.env[MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const dataBaseDir = options.dataBaseDir ?? options.env.MYCODE_DATA_BASE_DIR?.trim() ?? homedir();
  if (explicitMyCodeBuiltin && explicitPersonal) {
    return {
      [MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: explicitMyCodeBuiltin,
      [MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: explicitPersonal,
    };
  }

  const mycodeBuiltinFilePath =
    explicitMyCodeBuiltin ??
    (await resolveBundledMyCodeBuiltinProviderConfig({
      dataBaseDir,
      entrypoint: options.entrypoint ?? process.argv[1],
      sea: options.sea ?? getSeaProviderConfigAssets(),
    }));
  const personalFilePath =
    explicitPersonal ?? join(dataBaseDir, ".mycode", "v2", PERSONAL_PROVIDER_CONFIG_FILE_NAME);
  // 旧 CDN 缓存可能仍含账号模型；始终读取随应用提供的 Built-in。
  const source = new NodeMyCodeBuiltinProviderConfigSource({
    bundledFilePath: mycodeBuiltinFilePath,
    watch: false,
  });
  try {
    await source.read();
  } finally {
    source.dispose();
  }

  return {
    [MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: mycodeBuiltinFilePath,
    [MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: personalFilePath,
  };
}

function requiresProviderRuntime(argv: readonly string[]): boolean {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v")) {
    return false;
  }
  if (
    argv.some(
      (arg) =>
        arg === "--prompt" ||
        arg.startsWith("--prompt=") ||
        arg === "--target" ||
        arg.startsWith("--target="),
    )
  ) {
    return true;
  }

  const command = argv[0];
  if (command === undefined || command.startsWith("-")) return true;
  return command === "tui" || command === "app-server" || command === "agent-server";
}

async function resolveBundledMyCodeBuiltinProviderConfig(input: {
  readonly dataBaseDir: string;
  readonly entrypoint: string | undefined;
  readonly sea: SeaProviderConfigAssets | undefined;
}): Promise<string> {
  if (input.sea?.isSea()) {
    const content = input.sea.getAsset(SEA_MYCODE_BUILTIN_PROVIDER_CONFIG_ASSET_KEY, "utf8");
    return materializeMyCodeBuiltinProviderConfig({
      environmentConfigRoot: join(input.dataBaseDir, ".mycode", "v2"),
      content,
    });
  }

  const entrypoint = input.entrypoint?.trim();
  if (!entrypoint) throw new Error("无法定位 CLI MyCode Built-in Provider Config：缺少入口路径");
  // 全局 bin 可以是软链接，随包配置必须相对真实入口定位。
  const entryDirectory = dirname(realpathSync(resolve(entrypoint)));
  const candidates = [
    join(entryDirectory, "provider", "mycode-builtin.json"),
    resolve(entryDirectory, "../../../../../config/provider/mycode-builtin.json"),
  ];
  const candidate = candidates.find((filePath) => existsSync(filePath));
  if (candidate) return candidate;
  throw new Error(`无法定位 CLI MyCode Built-in Provider Config：${candidates.join(", ")}`);
}

function getSeaProviderConfigAssets(): SeaProviderConfigAssets | undefined {
  const getBuiltinModule = process.getBuiltinModule as
    | ((id: "node:sea") => typeof import("node:sea"))
    | undefined;
  return getBuiltinModule?.("node:sea");
}
