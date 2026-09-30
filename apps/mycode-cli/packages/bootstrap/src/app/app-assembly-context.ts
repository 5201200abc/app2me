import { type TraceContext } from "@mycode/contracts";

import { StartupTimer } from "../startup-logging.js";

import type { MyCodeAppOptions } from "./types.js";
import { resolveEffectiveConfigResult } from "./app-config-options.js";

import type { Logger, SessionId } from "@mycode/contracts";
/** Immutable startup inputs; resource ownership remains in createMyCodeApp. */
export interface AppAssemblyContext {
  options: MyCodeAppOptions;
  appVersion: string;
  sessionId: SessionId;
  traceContext: TraceContext;
  workingDirectory: string;
  configResult: ReturnType<typeof resolveEffectiveConfigResult>;
  logger: Logger;
  startupTimer: StartupTimer;
}
