import type { MyCodeEnv } from "./env.js";

const LOCAL_ENDPOINT_ORIGIN = "http://127.0.0.1:3030";
export const DEFAULT_MYCODE_ENDPOINT_ORIGIN = LOCAL_ENDPOINT_ORIGIN;

// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。
declare const __MYCODE_ENDPOINT_ENV__: Record<string, string | undefined> | undefined;
export function pickProductEndpointEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const keys = ["MYCODE_BASE_URL", "MYCODE_ENDPOINT_ORIGIN"];
  return Object.fromEntries(
    keys.flatMap((key) => (env[key]?.trim() ? [[key, env[key]!.trim()]] : [])),
  );
}
export function readProductEndpointEnv(): Record<string, string | undefined> {
  return {
    ...(typeof __MYCODE_ENDPOINT_ENV__ === "undefined" ? {} : __MYCODE_ENDPOINT_ENV__),
    ...pickProductEndpointEnv(typeof process === "undefined" ? {} : process.env),
  };
}

export interface MyCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  webShareCallbackUrl: string;
  mycodePlanOpenAiBaseUrl: string;
  mycodePlanAnthropicBaseUrl: string;
  mycodePlanBillingCurrentUrl: string;
  mycodePlanBillingBalanceUrl: string;
}

export interface RuntimeMyCodeEndpointEnv {
  [key: string]: string | undefined;
  MYCODE_ENV?: string;
  MYCODE_BASE_URL?: string;
  MYCODE_ENDPOINT_ORIGIN?: string;
}

export interface RuntimeProductEndpointEnv extends RuntimeMyCodeEndpointEnv {}

export interface RuntimeProductEndpointConfig {
  mycodeEnv: MyCodeEnv;
  mycodeEndpointOrigin: string;
  mycodeEndpointUrls: MyCodeEndpointUrls;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeMyCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("MyCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MyCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

export function resolveMyCodeEndpointOrigin(options?: {
  env?: MyCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const origin = options?.overrideOrigin?.trim() || options?.envBaseOrigin?.trim();
  return origin ? normalizeMyCodeEndpointOrigin(origin) : DEFAULT_MYCODE_ENDPOINT_ORIGIN;
}

export function resolveRuntimeMyCodeEnv(
  env: RuntimeMyCodeEndpointEnv = readProductEndpointEnv(),
): MyCodeEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.MYCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeMyCodeEndpointOrigin(
  env: RuntimeMyCodeEndpointEnv = readProductEndpointEnv(),
  options?: { overrideOrigin?: string | null },
): string {
  return resolveMyCodeEndpointOrigin({
    envBaseOrigin:
      readRuntimeEnvValue(env, "MYCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "MYCODE_ENDPOINT_ORIGIN"),
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeMyCodeEndpointUrls(
  env: RuntimeMyCodeEndpointEnv = readProductEndpointEnv(),
): MyCodeEndpointUrls {
  return buildMyCodeEndpointUrls(resolveRuntimeMyCodeEndpointOrigin(env));
}

export function buildRuntimeMyCodeApiUrl(
  env: RuntimeMyCodeEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeMyCodeEndpointOrigin(env)}${normalizedPath}`;
}

export function resolveRuntimeProductEndpointConfig(
  env: RuntimeProductEndpointEnv = readProductEndpointEnv(),
): RuntimeProductEndpointConfig {
  const mycodeEnv = resolveRuntimeMyCodeEnv(env);
  const mycodeEndpointOrigin = resolveRuntimeMyCodeEndpointOrigin(env);

  return {
    mycodeEnv,
    mycodeEndpointOrigin,
    mycodeEndpointUrls: buildMyCodeEndpointUrls(mycodeEndpointOrigin),
  };
}

export function buildMyCodeEndpointUrls(origin: string): MyCodeEndpointUrls {
  const normalizedOrigin = normalizeMyCodeEndpointOrigin(origin);
  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
    webShareCallbackUrl: `${normalizedOrigin}/cn/share/callback`,
    mycodePlanOpenAiBaseUrl: `${normalizedOrigin}/api/v1/mycode-plan`,
    mycodePlanAnthropicBaseUrl: `${normalizedOrigin}/api/v1/mycode-plan/anthropic`,
    mycodePlanBillingCurrentUrl: `${normalizedOrigin}/api/v1/mycode-plan/billing/current`,
    mycodePlanBillingBalanceUrl: `${normalizedOrigin}/api/v1/mycode-plan/billing/balance`,
  };
}

export function rewriteMyCodeEndpointUrl(
  input: string | URL,
  endpointOrigin: string,
): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_MYCODE_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeMyCodeEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
