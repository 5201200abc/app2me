import { type AuthProvider, type OAuthClientProvider } from "@modelcontextprotocol/client";
import type {
  McpCallToolOptions,
  McpCallToolRequest,
  McpConnectOptions,
  McpConnectionSnapshot,
  McpPort,
  McpServerConfig,
  McpServerStatus,
  McpToolCallResult,
  McpToolDescriptor,
} from "@mycode/contracts";

import { type McpServerFailureKind } from "@mycode/shared";

import { type McpOAuthRuntimeOptions } from "./oauth.js";
import { type InteractiveAuthorizationTrigger } from "./oauth-errors.js";
import { type McpInteractiveAuthorizationOutcome } from "./oauth-interactive.js";
import { type SharedMyCodeCredentialStore } from "../auth/shared-credentials.js";

import { type McpDeadline } from "./timeout.js";
import {
  type McpServerRecord,
  type OfficialMcpAuthMetaPayload,
  type McpClient,
  type AuthorizationCodeOAuthConfig,
  type McpTransport,
} from "./mcp-create-mcp-adapter-options.js";
import { McpAdapterState } from "./adapter-state.js";
import * as adapterConnections from "./adapter-connections.js";
import * as adapterConnectionOpen from "./adapter-connection-open.js";
import * as adapterConnectionLifecycle from "./adapter-connection-lifecycle.js";
import * as adapterToolInvocation from "./adapter-tool-invocation.js";
import * as adapterAuthorizationRecovery from "./adapter-authorization-recovery.js";
import * as adapterOfficialAuth from "./adapter-official-auth.js";
import * as adapterTransports from "./adapter-transports.js";
/** Internal assembly of MCP operations over one state owner; forwarding preserves promise identity. */
export class NodeMcpAdapter extends McpAdapterState implements McpPort {
  connectConfiguredServers(
    servers: Record<string, McpServerConfig>,
    options: McpConnectOptions = {},
  ): Promise<McpConnectionSnapshot> {
    return adapterConnections.connectConfiguredServers.call(this, servers, options);
  }
  connectServer(
    name: string,
    config: McpServerConfig,
    options: McpConnectOptions = {},
  ): Promise<McpServerStatus> {
    return adapterConnections.connectServer.call(this, name, config, options);
  }
  waitForSharedConnection(
    name: string,
    record: McpServerRecord,
    options: McpConnectOptions,
  ): Promise<McpServerStatus> {
    return adapterConnections.waitForSharedConnection.call(this, name, record, options);
  }
  openServerConnection(input: {
    config: McpServerConfig;
    generation: number;
    name: string;
    oauthAuthorizationTimeoutMs?: number;
    signal: AbortSignal;
    timeoutMs: number;
    workingDirectory?: string;
    oauthAuthorizationAttempted?: boolean;
  }): Promise<McpServerStatus> {
    return adapterConnectionOpen.openServerConnection.call(this, input);
  }
  failConnection(input: {
    client?: McpClient;
    config: McpServerConfig;
    connectDurationMs?: number;
    error: unknown;
    failureKind?: McpServerFailureKind;
    generation: number;
    getRecentStderr?: () => string | undefined;
    listToolsDurationMs?: number;
    name: string;
    startedAt: number;
    transport?: McpTransport;
  }): Promise<McpServerStatus> {
    return adapterConnectionOpen.failConnection.call(this, input);
  }
  disconnectServer(name: string): Promise<McpServerStatus | undefined> {
    return adapterConnectionLifecycle.disconnectServer.call(this, name);
  }
  status(): Promise<Record<string, McpServerStatus>> {
    return adapterConnectionLifecycle.status.call(this);
  }
  pingServer(name: string, options: { timeoutMs?: number } = {}): Promise<boolean> {
    return adapterConnectionLifecycle.pingServer.call(this, name, options);
  }
  listTools(): Promise<McpToolDescriptor[]> {
    return adapterConnectionLifecycle.listTools.call(this);
  }
  close(): Promise<void> {
    return adapterConnectionLifecycle.close.call(this);
  }
  closeRecord(name: string): Promise<void> {
    return adapterConnectionLifecycle.closeRecord.call(this, name);
  }
  closeClientAndTransport(
    name: string,
    client?: McpClient,
    transport?: McpTransport,
  ): Promise<void> {
    return adapterConnectionLifecycle.closeClientAndTransport.call(this, name, client, transport);
  }
  terminateStdioProcessTree(name: string, transport?: McpTransport): Promise<void> {
    return adapterConnectionLifecycle.terminateStdioProcessTree.call(this, name, transport);
  }
  callTool(
    request: McpCallToolRequest,
    options: McpCallToolOptions = {},
  ): Promise<McpToolCallResult> {
    return adapterToolInvocation.callTool.call(this, request, options);
  }
  callToolOnClient(
    client: McpClient,
    request: McpCallToolRequest,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<McpToolCallResult> {
    return adapterToolInvocation.callToolOnClient.call(this, client, request, timeoutMs, signal);
  }
  reconnectForCall(name: string, config: McpServerConfig): Promise<void> {
    return adapterToolInvocation.reconnectForCall.call(this, name, config);
  }
  recoverToolCallAuthorization(input: {
    deadline: McpDeadline;
    error: unknown;
    record: McpServerRecord;
    request: McpCallToolRequest;
    signal?: AbortSignal;
    timeoutMessage: string;
    trigger: InteractiveAuthorizationTrigger;
  }): Promise<McpToolCallResult> {
    return adapterAuthorizationRecovery.recoverToolCallAuthorization.call(this, input);
  }
  ensureToolCallAuthorizationRecovery(input: {
    config: Extract<McpServerConfig, { type: "http" | "sse" }>;
    name: string;
    oauthConfig: AuthorizationCodeOAuthConfig;
    record: McpServerRecord;
    trigger: InteractiveAuthorizationTrigger;
  }): Promise<McpServerStatus> {
    return adapterAuthorizationRecovery.ensureToolCallAuthorizationRecovery.call(this, input);
  }
  runToolCallAuthorizationRecovery(input: {
    abortController: AbortController;
    config: Extract<McpServerConfig, { type: "http" | "sse" }>;
    generation: number;
    name: string;
    oauthConfig: AuthorizationCodeOAuthConfig;
    previousClient?: McpClient;
    previousTransport?: McpTransport;
    trigger: InteractiveAuthorizationTrigger;
  }): Promise<McpServerStatus> {
    return adapterAuthorizationRecovery.runToolCallAuthorizationRecovery.call(this, input);
  }
  runInteractiveOAuthAuthorization(input: {
    config: Extract<McpServerConfig, { type: "http" | "sse" }>;
    generation: number;
    name: string;
    oauthConfig: AuthorizationCodeOAuthConfig;
    serverUrl: string;
    signal: AbortSignal;
    trigger: InteractiveAuthorizationTrigger;
  }): Promise<McpInteractiveAuthorizationOutcome> {
    return adapterAuthorizationRecovery.runInteractiveOAuthAuthorization.call(this, input);
  }
  resolveOfficialStdioAuthMeta(
    serverName: string,
    config: McpServerConfig,
    signal: AbortSignal | undefined,
  ): Promise<OfficialMcpAuthMetaPayload | undefined> {
    return adapterOfficialAuth.resolveOfficialStdioAuthMeta.call(this, serverName, config, signal);
  }
  createOfficialAuthFetch(
    config: McpServerConfig,
    serverName: string,
    generation: number,
  ): typeof globalThis.fetch | undefined {
    return adapterOfficialAuth.createOfficialAuthFetch.call(this, config, serverName, generation);
  }
  createTransport(
    config: McpServerConfig,
    serverName: string,
    generation: number,
    _oauthAuthorizationTimeoutMs?: number,
    workingDirectory?: string,
    signal?: AbortSignal,
  ): Promise<{ transport: McpTransport }> {
    return adapterTransports.createTransport.call(
      this,
      config,
      serverName,
      generation,
      _oauthAuthorizationTimeoutMs,
      workingDirectory,
      signal,
    );
  }
  createOAuthClientProvider(
    serverName: string,
    config: McpServerConfig,
  ): AuthProvider | OAuthClientProvider | undefined {
    return adapterTransports.createOAuthClientProvider.call(this, serverName, config);
  }
  resolveCredentialStore(): SharedMyCodeCredentialStore {
    return adapterTransports.resolveCredentialStore.call(this);
  }
  createAuthorizationCodeOAuthOptions(
    config: McpServerConfig,
    serverName: string,
    generation: number,
    oauthAuthorizationTimeoutMs?: number,
  ): McpOAuthRuntimeOptions | undefined {
    return adapterTransports.createAuthorizationCodeOAuthOptions.call(
      this,
      config,
      serverName,
      generation,
      oauthAuthorizationTimeoutMs,
    );
  }
  attachStdioLogging(name: string, transport: McpTransport): () => string | undefined {
    return adapterTransports.attachStdioLogging.call(this, name, transport);
  }
}
