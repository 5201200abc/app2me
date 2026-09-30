import { materializeMyCodeBuiltinProviderConfig } from "@mycode/services/node";

declare const __MYCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledMyCodeBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 MyCode Built-in Provider Config。 */
export function readBundledMyCodeBuiltinProviderConfig(): string {
  if (typeof __MYCODE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 MyCode Built-in Provider Config");
  }
  return __MYCODE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 MyCode Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledMyCodeBuiltinProviderConfig(
  options: MaterializeBundledMyCodeBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeMyCodeBuiltinProviderConfig(options);
}
