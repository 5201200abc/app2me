import { createHash } from "node:crypto";
import { type FetchLike } from "@modelcontextprotocol/client";
import type { Logger, McpOAuthConfig } from "@mycode/contracts";
import type { SharedMyCodeCredentialStore } from "../auth/shared-credentials.js";
import { loadCanonicalCredentials, type CanonicalCredentialSnapshot } from "./oauth-credentials.js";
import { loadPendingAuthorization } from "./oauth-lease.js";
import { type McpOAuthAuthorizationContext } from "./oauth-shared.js";

export type McpAuthorizationCodeOAuthConfig = Extract<
  McpOAuthConfig,
  { type: "authorization_code" }
>;

/** 授权事务的全局寿命。与 caller 等待预算（session 15s）无关，由 caller 侧独立收口。 */
export const MCP_OAUTH_AUTHORIZATION_TRANSACTION_TTL_MS = 5 * 60 * 1000;

export const FOLLOWER_POLL_INTERVAL_MS = 500;

export type McpInteractiveAuthorizationOutcome =
  /** 本次调用完成了授权，凭据已发布。 */
  | { status: "authorized" }
  /** 另一个事务已完成授权（generation 已换代），直接回 Phase 1 重连即可。 */
  | { status: "already-authorized" }
  /** 事务仍在进行（本调用是 follower 或已达事务 TTL），授权 URL 可供展示。 */
  | { status: "pending"; authorizationUrl?: string }
  | { status: "failed"; error: unknown };

export interface McpInteractiveAuthorizationInput {
  adapterInstanceId?: string;
  config: McpAuthorizationCodeOAuthConfig;
  credentialStore: SharedMyCodeCredentialStore;
  fetchFn?: FetchLike;
  /** 403 step-up：unionScope 是 requiredScope 的严格超集时，refresh 无法扩权，必须强制重新授权。 */
  forceReauthorization?: boolean;
  keyPrefix: string;
  logger?: Logger;
  onAuthorizationRequired?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
  openAuthorizationUrl?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
  /** 编排层算好的最终 scope（config scope ∪ token.scope ∪ challenge scope）。 */
  requestedScope?: string;
  resourceMetadataUrl?: URL;
  serverName: string;
  serverUrl: string;
  signal?: AbortSignal;
  transactionTtlMs?: number;
}

export async function followAuthorization(
  input: McpInteractiveAuthorizationInput,
  baselineGeneration: string | undefined,
  transactionTtlMs: number,
): Promise<McpInteractiveAuthorizationOutcome> {
  const deadline = Date.now() + transactionTtlMs;
  let projectedUrl: string | undefined;
  input.logger?.info("MCP OAuth authorization is already in progress elsewhere", {
    event: "mcp.oauth.authorization.following",
    ...logContext(input),
    status: "waiting",
  });

  while (Date.now() < deadline && !input.signal?.aborted) {
    const current = await loadCanonicalCredentials(input.credentialStore, input.keyPrefix);
    if (hasNewerCredentials(current, baselineGeneration)) return { status: "already-authorized" };

    const pending = await loadPendingAuthorization(input.credentialStore, input.keyPrefix);
    if (pending && pending.authorizationUrl !== projectedUrl) {
      // 设置页与 session 是独立 lease，leader 的 onAuthorizationRequired 回调对 follower
      // 不可见；follower 必须从共享 pending 键把同一个授权 URL 投影到自己的状态。
      projectedUrl = pending.authorizationUrl;
      await input.onAuthorizationRequired?.({
        authorizationUrl: pending.authorizationUrl,
        redirectUrl: "",
        serverName: input.serverName,
      });
    }
    await sleep(FOLLOWER_POLL_INTERVAL_MS, input.signal);
  }

  return { status: "pending", ...(projectedUrl ? { authorizationUrl: projectedUrl } : {}) };
}

export function hasNewerCredentials(
  current: CanonicalCredentialSnapshot | undefined,
  baselineGeneration: string | undefined,
): boolean {
  return Boolean(current?.tokens && current.generation !== baselineGeneration);
}

export function normalizeCallbackPath(value: string | undefined, serverName: string): string {
  const fallback = `/oauth/callback/mcp/${encodeURIComponent(serverName)}`;
  if (!value) return fallback;
  return value.startsWith("/") ? value : `/${value}`;
}

export function logContext(
  input: McpInteractiveAuthorizationInput,
  state?: string,
): Record<string, unknown> {
  return {
    adapterInstanceId: input.adapterInstanceId,
    credentialKeyPrefix: input.keyPrefix,
    mcpServerName: input.serverName,
    ...(state
      ? { oauthStateId: createHash("sha256").update(state).digest("hex").slice(0, 16) }
      : {}),
    processId: process.pid,
  };
}

export function hashIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
