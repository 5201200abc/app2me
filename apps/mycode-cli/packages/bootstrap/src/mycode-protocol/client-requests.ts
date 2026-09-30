import type { MyCodeProtocolMethod, MyCodeProtocolRequestId } from "@mycode/shared";

import {
  ProtocolRequestError,
  type ParamsSchema,
  type MyCodeProtocolClientRequestOptions,
} from "./server-types.js";

import {
  type MyCodeProtocolOutboundMessage,
  type PendingClientRequest,
  MAX_CLIENT_REQUEST_REANNOUNCE_INTERVAL_MS,
} from "./server-max-client-request-reannounce-interval-ms.js";
/** Owns one connection's reverse requests, reannouncement timers and disconnect state. */
export class ProtocolClientRequests {
  private messageSink?: (message: MyCodeProtocolOutboundMessage) => void;
  private clientDisconnectError?: Error;
  private readonly pendingClientRequests = new Map<string, PendingClientRequest<unknown>>();
  private nextClientRequestId = 1;
  setNotificationSink(sink: (message: MyCodeProtocolOutboundMessage) => void): void {
    this.clientDisconnectError = undefined;
    this.messageSink = sink;
  }
  notify(message: MyCodeProtocolOutboundMessage): void {
    this.messageSink?.(message);
  }
  clearNotificationSink(): void {
    this.messageSink = undefined;
  }
  disconnectClient(error: Error): void {
    this.clientDisconnectError = error;
    // 连接关闭后反向请求已不可能收到响应，必须先结束 pending，
    // 否则正在物化 Session 的 handler 会阻塞 connection 的关闭流程。
    const pendingRequests = new Set(this.pendingClientRequests.values());
    for (const pending of pendingRequests) {
      this.cleanupClientRequest(pending);
      pending.reject(error);
    }
  }
  requestClient<T>(
    method: MyCodeProtocolMethod,
    params: unknown,
    resultSchema: ParamsSchema<T>,
    options?: MyCodeProtocolClientRequestOptions,
  ): Promise<T> {
    if (this.clientDisconnectError) {
      throw this.clientDisconnectError;
    }
    if (!this.messageSink) {
      throw new ProtocolRequestError(-32020, `No MyCode Protocol client is attached for ${method}`);
    }

    return new Promise<T>((resolve, reject) => {
      let active = true;
      const pending: PendingClientRequest<T> = {
        method,
        reject,
        resolve,
        resultSchema,
        requestKeys: new Set(),
        signal: options?.signal,
      };
      const cleanup = () => {
        active = false;
        this.cleanupClientRequest(pending);
      };
      pending.abortHandler = () => {
        cleanup();
        reject(new ProtocolRequestError(-32021, `Client request cancelled: ${method}`));
      };
      if (options?.signal?.aborted) {
        pending.abortHandler();
        return;
      }
      if (options?.timeoutMs !== undefined) {
        pending.timeout = setTimeout(() => {
          cleanup();
          reject(
            new ProtocolRequestError(-32022, `Client request timed out: ${method}`, {
              timeoutMs: options.timeoutMs,
            }),
          );
        }, options.timeoutMs);
      }
      options?.signal?.addEventListener("abort", pending.abortHandler, { once: true });
      const sendClientRequest = () => {
        if (!active) {
          return;
        }
        const id = `server-${this.nextClientRequestId++}`;
        const key = String(id);
        pending.requestKeys.add(key);
        this.pendingClientRequests.set(key, pending as PendingClientRequest<unknown>);
        this.messageSink?.({
          id,
          method,
          params,
          ...(options?.trace ? { trace: options.trace } : {}),
        });
      };
      sendClientRequest();
      const reannounceIntervalMs =
        options?.reannounceIntervalMs !== undefined &&
        Number.isFinite(options.reannounceIntervalMs) &&
        options.reannounceIntervalMs > 0
          ? Math.floor(options.reannounceIntervalMs)
          : undefined;
      if (reannounceIntervalMs !== undefined) {
        let nextReannounceIntervalMs = reannounceIntervalMs;
        const scheduleReannounce = () => {
          pending.reannounceTimer = setTimeout(() => {
            if (!active) {
              return;
            }
            sendClientRequest();
            nextReannounceIntervalMs = Math.min(
              nextReannounceIntervalMs * 2,
              MAX_CLIENT_REQUEST_REANNOUNCE_INTERVAL_MS,
            );
            scheduleReannounce();
          }, nextReannounceIntervalMs);
        };
        scheduleReannounce();
      }
    });
  }
  resolveClientRequest(id: MyCodeProtocolRequestId, result: unknown): void {
    const key = String(id);
    const pending = this.pendingClientRequests.get(key);
    if (!pending) {
      return;
    }
    this.cleanupClientRequest(pending);
    try {
      pending.resolve(pending.resultSchema.parse(result));
    } catch (error) {
      pending.reject(
        error instanceof Error ? error : new Error(`Invalid response: ${pending.method}`),
      );
    }
  }
  rejectClientRequest(id: MyCodeProtocolRequestId, error: Error): void {
    const key = String(id);
    const pending = this.pendingClientRequests.get(key);
    if (!pending) {
      return;
    }
    this.cleanupClientRequest(pending);
    pending.reject(error);
  }
  private cleanupClientRequest<T>(pending: PendingClientRequest<T>): void {
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (pending.reannounceTimer) {
      clearTimeout(pending.reannounceTimer);
    }
    if (pending.abortHandler) {
      pending.signal?.removeEventListener("abort", pending.abortHandler);
    }
    for (const requestKey of pending.requestKeys) {
      this.pendingClientRequests.delete(requestKey);
    }
    pending.requestKeys.clear();
  }
}
