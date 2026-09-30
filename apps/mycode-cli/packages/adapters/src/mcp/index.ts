import { NodeMcpAdapter } from "./adapter.js";

import type { McpPort } from "@mycode/contracts";

import { createMcpConnectionPool, type McpConnectionPool } from "./pool.js";

import { type CreateMcpAdapterOptions } from "./mcp-create-mcp-adapter-options.js";

export function createMcpAdapter(options: CreateMcpAdapterOptions = {}): McpPort {
  return new NodeMcpAdapter(options);
}

export function createMcpAdapterConnectionPool(
  options: CreateMcpAdapterOptions = {},
): McpConnectionPool {
  return createMcpConnectionPool({
    logger: options.logger,
    telemetry: options.telemetry,
    createAdapter: ({ connectionContext, workingDirectory }) =>
      createMcpAdapter({
        ...options,
        connectionContext,
        workingDirectory: workingDirectory ?? options.workingDirectory,
      }),
  });
}

export {
  createMcpConnectionPool,
  type McpConnectionPool,
  type McpConnectionPoolOptions,
} from "./pool.js";

export {
  createMcpTelemetryTracker,
  resolvePluginName,
  type McpTelemetryTracker,
  type McpTrackedProcess,
} from "./telemetry.js";

export type { CreateMcpAdapterOptions } from "./mcp-create-mcp-adapter-options.js";
