import {
  buildRuntimeMyCodeEndpointUrls,
  MYCODE_ENV,
  type RuntimeMyCodeEndpointEnv,
} from "@mycode/shared";

interface RendererImportMetaEnv {
  VITE_MYCODE_BASE_URL?: string;
  VITE_MYCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererMyCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeMyCodeEndpointEnv {
  return {
    MYCODE_ENV,
    // UI 侧的 mycode-plan 占位 provider 以前只看 MYCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    MYCODE_BASE_URL: env.VITE_MYCODE_BASE_URL,
    MYCODE_ENDPOINT_ORIGIN: env.VITE_MYCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_MYCODE_ENDPOINT_URLS = buildRuntimeMyCodeEndpointUrls(
  createRendererMyCodeEndpointEnv(),
);
