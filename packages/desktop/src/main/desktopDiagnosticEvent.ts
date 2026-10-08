import { logger } from "./logger.js";

/** Retired vendor telemetry is retained only as existing local development diagnostics. */
export function recordDesktopDiagnosticEvent(event: unknown): void {
  logger.debug("[desktop-diagnostic]", event);
}
