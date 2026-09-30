import { join } from "node:path";
import { createNodeToolArtifactStore } from "@mycode/adapters/storage";

import { resolvePath } from "@mycode/adapters/config";
import { createNodeExecutionAdapter } from "@mycode/adapters/exec";
import { createNodeFileSystemAdapter } from "@mycode/adapters/fs";
import { createNodeWebFetchHttpClientAdapter } from "@mycode/adapters/http";
import { createJimpImageProcessorAdapter } from "@mycode/adapters/image";
import { createPopplerPdfDocumentAdapter } from "@mycode/adapters/pdf";
import { createNodeSessionMailboxAdapter } from "@mycode/adapters/mailbox";

import { createMcpAdapter } from "@mycode/adapters/mcp";
import { PermissionService } from "@mycode/core";

import type { MyCodeAppOptions } from "./types.js";
import { isMessageEnabled } from "./app-config-options.js";

import { asInputHistoryStore } from "./session-store.js";

import { resolveAppRuntimeConfig } from "./runtime-config.js";

import {
  debugRuntimeConfigResolved,
  markMcpAdapterInitialized,
  markStorageAdaptersInitialized,
} from "./startup-marks.js";
import type { AppAssemblyContext } from "./app-assembly-context.js";
interface PlatformPortsDeps extends Pick<
  AppAssemblyContext,
  "options" | "appVersion" | "configResult" | "logger" | "startupTimer" | "workingDirectory"
> {
  storageRoot: string;
  cliStorageRoot: string;
  sessionStore: NonNullable<MyCodeAppOptions["sessionStore"]>;
  runtimeConfig: ReturnType<typeof resolveAppRuntimeConfig>["runtimeConfig"];
  configuredMcpServers: ReturnType<typeof resolveAppRuntimeConfig>["configuredMcpServers"];
}
export function createAppPlatformPorts(deps: PlatformPortsDeps) {
  const {
    options,
    appVersion,
    configResult,
    logger,
    startupTimer,
    workingDirectory,
    storageRoot,
    cliStorageRoot,
    sessionStore,
    runtimeConfig,
    configuredMcpServers,
  } = deps;
  const permissionService = new PermissionService({
    allowedTools: new Set(configResult.config.permission.allowedTools),
    autoApproveHighRisk: configResult.config.permission.autoApproveHighRisk,
    disallowedTools: new Set(configResult.config.permission.disallowedTools),
    allowMediumRiskInAutoMode: configResult.config.permission.allowMediumRiskInAuto,
  });
  const inputHistoryStore = options.inputHistoryStore ?? asInputHistoryStore(sessionStore);
  const artifactStore =
    options.artifactStore ??
    createNodeToolArtifactStore({
      imageCacheRootDir: join(storageRoot, "cli", "image-cache"),
      pdfCacheRootDir: join(storageRoot, "cli", "pdf-cache"),
      rootDir: join(storageRoot, "cli", "artifacts"),
      videoCacheRootDir: join(storageRoot, "cli", "video-cache"),
    });
  const imageProcessorPort = options.imageProcessorPort ?? createJimpImageProcessorAdapter();
  const messageEnabled = isMessageEnabled(options.env ?? process.env);
  const sessionMailboxPort =
    options.sessionMailboxPort ??
    (messageEnabled
      ? createNodeSessionMailboxAdapter({
          rootDir: resolvePath(
            (options.env ?? process.env).MYCODE_MAILBOX_ROOT ?? "~/.mycode/mailbox",
          ),
        })
      : undefined);
  markStorageAdaptersInitialized({
    cliStorageRoot,
    hasInjectedArtifactStore: options.artifactStore !== undefined,
    hasInjectedSessionStore: options.sessionStore !== undefined,
    startupTimer,
    storageRoot,
  });
  const mcpPort =
    options.mcpPort ??
    (runtimeConfig.mcp?.enabled === false
      ? undefined
      : (options.mcpPortFactory?.({ workingDirectory }) ??
        createMcpAdapter({
          clientVersion: appVersion,
          env: options.env,
          logger,
          network: {
            httpProxy: configResult.config.network.httpProxy,
            noProxy: configResult.config.network.noProxy,
            caCertFile: configResult.config.network.caCertFile,
          },
          workingDirectory,
        })));
  const ownsMcpPort = options.mcpPort === undefined && mcpPort !== undefined;
  const executionPort =
    options.executionPort ??
    createNodeExecutionAdapter({
      onToolExecResource: options.onToolExecResource,
      network: {
        httpProxy: configResult.config.network.httpProxy,
        noProxy: configResult.config.network.noProxy,
        caCertFile: configResult.config.network.caCertFile,
      },
      outputRootDir: join(storageRoot, "cli", "exec"),
      processEnv: options.env ?? process.env,
    });
  const ownsExecutionPort = options.executionPort === undefined;
  const pdfDocumentPort =
    options.pdfDocumentPort ?? createPopplerPdfDocumentAdapter({ executionPort });
  // browser-use 控制端口：仅当宿主（desktop）注入时可用，无本地 fallback（纯 CLI 无浏览器底座）。
  const fileSystemPort = options.fileSystemPort ?? createNodeFileSystemAdapter();
  const httpClientPort =
    options.httpClientPort ??
    createNodeWebFetchHttpClientAdapter({
      env: options.env ?? process.env,
      timeoutMs: configResult.config.network.timeout,
      proxyUrl: configResult.config.network.httpProxy,
      noProxy: configResult.config.network.noProxy,
      caCertFile: configResult.config.network.caCertFile,
    });
  markMcpAdapterInitialized({
    configuredMcpServers,
    hasInjectedMcpPort: options.mcpPort !== undefined,
    mcpEnabled: runtimeConfig.mcp?.enabled !== false,
    startupTimer,
    trustedMcpServerCount: Object.keys(runtimeConfig.mcp?.servers ?? {}).length,
  });
  debugRuntimeConfigResolved({
    configResult,
    logger,
    runtimeConfig,
  });
  return {
    permissionService,
    inputHistoryStore,
    artifactStore,
    imageProcessorPort,
    sessionMailboxPort,
    mcpPort,
    ownsMcpPort,
    executionPort,
    ownsExecutionPort,
    pdfDocumentPort,
    fileSystemPort,
    httpClientPort,
  };
}
export type AppPlatformPorts = ReturnType<typeof createAppPlatformPorts>;
