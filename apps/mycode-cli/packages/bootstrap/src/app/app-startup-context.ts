import type { AppAssemblyContext } from "./app-assembly-context.js";

import { resolve } from "node:path";

import { createNodeLoggerFactory } from "@mycode/adapters/logging";
import { createConfig } from "@mycode/adapters/config";

import { createModelTelemetry } from "@mycode/telemetry";
import {
  createRootTraceContext,
  traceContextToLogContext,
  createSessionId,
} from "@mycode/contracts";

import { StartupTimer, startupNow } from "../startup-logging.js";

import type { MyCodeAppOptions } from "./types.js";
import { createConfigCliOverrides, resolveEffectiveConfigResult } from "./app-config-options.js";

import { markConfigurationLoaded, startAppStartup } from "./startup-marks.js";
import type { Logger, LoggerFactory } from "@mycode/contracts";
interface AppStartupContext extends AppAssemblyContext {
  loggerFactory: LoggerFactory;
  modelLogger: Logger;
  modelTelemetry: ReturnType<typeof createModelTelemetry>;
}
export function createAppStartupContext(options: MyCodeAppOptions): AppStartupContext {
  const startupStartedAt = startupNow();
  const appVersion = options.version ?? "0.0.0";
  const sessionId = options.sessionId ?? createSessionId();
  const traceContext = options.traceContext ?? createRootTraceContext({ sessionId });
  const workingDirectory = resolve(options.runtimeConfig?.workingDirectory ?? process.cwd());
  const configResult = resolveEffectiveConfigResult(
    createConfig({
      env: options.env,
      projectConfigPath: options.projectConfigPath,
      workingDirectory,
      workspaceIdentity: options.runtimeConfig?.memory?.workspaceIdentity,
      skipUserConfig: options.skipUserConfig,
      userConfigPath: options.userConfigPath,
      cliOverrides: createConfigCliOverrides(options),
    }),
    options,
  );
  const loggerFactory = options.loggerFactory ?? createNodeLoggerFactory({ env: options.env });
  const logger = loggerFactory.createLogger("mycode").child({
    ...traceContextToLogContext(traceContext),
    module: "bootstrap",
  });
  const startupTimer = new StartupTimer(
    logger,
    {
      ...traceContextToLogContext(traceContext),
      module: "bootstrap",
      startupKind: "mycode_app",
    },
    startupStartedAt,
  );
  startAppStartup({
    hasInjectedModelAdapter: options.modelAdapter !== undefined,
    resume: options.resume === true,
    startupTimer,
  });
  markConfigurationLoaded({
    configResult,
    startupTimer,
  });
  const modelLogger = loggerFactory.createLogger("mycode").child({
    ...traceContextToLogContext(traceContext),
    module: "adapters.model",
  });
  const modelTelemetry = createModelTelemetry({
    owner: options.telemetryOwner,
    sessionId,
  });
  return {
    options,
    appVersion,
    sessionId,
    traceContext,
    workingDirectory,
    configResult,
    logger,
    startupTimer,
    loggerFactory,
    modelLogger,
    modelTelemetry,
  };
}
