import { createLocalServices, getAppConfigDir } from "@mycode/services/node";
import {
  materializeBundledMyCodeBuiltinProviderConfig,
  readBundledMyCodeBuiltinProviderConfig,
} from "./bundledMyCodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const mycodeBuiltinProviderConfigFilePath = await materializeBundledMyCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledMyCodeBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["MYCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["MYCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["MYCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    mycodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[mycode-server:http] startup failed", error);
  process.exitCode = 1;
});
