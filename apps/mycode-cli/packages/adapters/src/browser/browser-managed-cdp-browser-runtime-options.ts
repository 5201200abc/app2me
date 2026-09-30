import type { BrowserControlPort } from "@mycode/contracts";
import {
  type BrowserExecutableResolutionOptions,
  type PlaywrightChromiumModule,
} from "./executable.js";

export interface ManagedCdpBrowserRuntimeOptions extends BrowserExecutableResolutionOptions {
  closeTimeoutMs?: number;
  loadPlaywright?: () => Promise<PlaywrightChromiumModule>;
}

export interface ManagedCdpBrowserRuntime {
  browserControlPort: BrowserControlPort;
  close(): Promise<void>;
}

export interface PendingRequest {
  controller: AbortController;
  sessionId: string;
  turnId?: string;
}

export const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = 1_500;

export function waitForPromise(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(completed);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    void promise.then(
      () => finish(true),
      () => finish(true),
    );
  });
}
