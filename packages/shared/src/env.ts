import type { MyCodeRuntimeEnv } from "./runtimeEnv.js";

export type MyCodeEnv = "test" | "production";
/** 安装包身份：决定应用名、app id、Electron 数据目录与更新策略；与后端环境 `MyCodeEnv` 是两个轴。 */
export type MyCodeProductFlavor = "production" | "preview";
export type ArmsRumEnv = "local" | "prod";

// 非构建环境（如 e2e 测试的 mocha）下 define 不存在，用 typeof 检查 + fallback 避免 ReferenceError
declare const __MYCODE_ENV__: string;
declare const __MYCODE_PRODUCT_FLAVOR__: string;

export function normalizeMyCodeEnv(value: string | undefined): MyCodeEnv {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export const MYCODE_ENV = normalizeMyCodeEnv(
  typeof __MYCODE_ENV__ !== "undefined" ? __MYCODE_ENV__ : undefined,
);

/**
 * 身份缺省跟随后端环境（test → preview，production → production）。
 * 桌面构建通过 `MYCODE_PREVIEW_IDENTITY=1` 显式注入 preview，得到连接生产后端的 Preview 包；
 * 未注入 define 的 bundle（web、CLI、测试）沿用旧的单轴语义。
 */
export function normalizeMyCodeProductFlavor(
  value: string | undefined,
  mycodeEnv: MyCodeEnv,
): MyCodeProductFlavor {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "preview") {
    return normalized;
  }
  return mycodeEnv === "production" ? "production" : "preview";
}

export const MYCODE_PRODUCT_FLAVOR = normalizeMyCodeProductFlavor(
  typeof __MYCODE_PRODUCT_FLAVOR__ !== "undefined" ? __MYCODE_PRODUCT_FLAVOR__ : undefined,
  MYCODE_ENV,
);
export const MYCODE_APP_VERSION_ENV = "MYCODE_APP_VERSION" as const;
export const MYCODE_BUILD_COMMIT_ID_ENV = "MYCODE_BUILD_COMMIT_ID" as const;

// ── 运行时环境变量（不经过编译打包，启动时从 process.env 读取） ──
// 启用调试模式，值为 inspect-brk 的端口号，如 MYCODE_DEBUG=9230
export const RUNTIME_MYCODE_DEBUG =
  typeof process !== "undefined" ? process.env.MYCODE_DEBUG : undefined;

// 旧官方数仓已退役；即使遗留环境变量仍配置端点，也不发送应用事件。
export const MYCODE_TELEMETRY_ENABLED: boolean = false;

/** 数仓事件上报端点：由运行时环境变量提供，未配置即停用，构建产物不内嵌。 */
export const MYCODE_TELEMETRY_REPORT_ENDPOINT =
  typeof process !== "undefined" ? (process.env.MYCODE_TELEMETRY_REPORT_ENDPOINT ?? "") : "";

/** ARMS RUM 接入端点：由运行时环境变量提供，未配置即停用，构建产物不内嵌。 */
export const MYCODE_ARMS_RUM_ENDPOINT =
  typeof process !== "undefined" ? (process.env.MYCODE_ARMS_RUM_ENDPOINT ?? "") : "";

/** 将本地运行态与编译期 MYCODE_ENV 映射为 ARMS 控制台识别的上报环境标签 */
export function mapMyCodeEnvToArmsRumEnv(runtimeEnv: MyCodeRuntimeEnv): ArmsRumEnv {
  return runtimeEnv !== "development" && MYCODE_ENV === "production" ? "prod" : "local";
}
