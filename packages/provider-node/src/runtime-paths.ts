export const MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "MYCODE_BUILTIN_PROVIDER_CONFIG_FILE";
export const MYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "MYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "MYCODE_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly mycodeBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.mycodeBuiltinFilePath,
    [MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const mycodeBuiltinFilePath = env[MYCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[MYCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!mycodeBuiltinFilePath && !personalFilePath) return null;
  if (!mycodeBuiltinFilePath || !personalFilePath) {
    throw new Error("MyCode Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ mycodeBuiltinFilePath, personalFilePath });
}
