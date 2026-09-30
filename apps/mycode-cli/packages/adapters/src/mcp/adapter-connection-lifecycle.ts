import type { McpServerStatus, McpToolDescriptor } from "@mycode/contracts";

import { terminateMcpStdioProcessTree } from "./process-tree.js";
import { ProcessTreeStdioClientTransport } from "./stdio-transport.js";

import {
  DEFAULT_MCP_TIMEOUT_MS,
  MCP_PING_TIMEOUT_MS,
  isPeerAnsweredError,
  type McpClient,
  type McpTransport,
  getStdioTransportPid,
} from "./mcp-create-mcp-adapter-options.js";
import type { NodeMcpAdapter } from "./adapter.js";

export async function disconnectServer(
  this: NodeMcpAdapter,
  name: string,
): Promise<McpServerStatus | undefined> {
  const record = this.records.get(name);
  if (!record) return undefined;

  this.nextConnectionGeneration(name);
  await this.closeRecord(name);
  const status = this.createStatus(record.config, "disconnected");
  this.records.set(name, {
    config: record.config,
    status,
    tools: [],
  });
  return status;
}

export async function status(this: NodeMcpAdapter): Promise<Record<string, McpServerStatus>> {
  return Object.fromEntries(
    Array.from(this.records.entries()).map(([name, record]) => [name, record.status]),
  );
}
// HTTP/SSE MCP 服务被停掉时不会派发 onclose（没有常驻流可断），record 会长期停在
// connected；设置页刷新读到的就是这份"无声死亡"的旧快照，看起来像刷新按钮没生效。
// ping 是 MCP 基础协议方法，用它把 transport 存活性显式化。
export async function pingServer(
  this: NodeMcpAdapter,
  name: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const record = this.records.get(name);
  if (!record?.client || record.status.status !== "connected") {
    return false;
  }
  const timeoutMs = Math.min(
    options.timeoutMs ?? MCP_PING_TIMEOUT_MS,
    record.config.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
  );
  const generation = this.connectionGenerations.get(name) ?? 0;
  try {
    await record.client.ping({ timeout: timeoutMs });
    return true;
  } catch (error) {
    // server 回了 JSON-RPC 错误（例如未实现 ping）说明连接本身是活的，不能据此拆连接。
    if (isPeerAnsweredError(error)) {
      return true;
    }
    if (!this.isCurrentConnection(name, generation)) return false;
    const current = this.records.get(name);
    if (current && current.client === record.client) {
      current.status = this.createStatus(current.config, "disconnected", {
        error: "MCP server did not answer ping",
        failureKind: "unexpected_disconnect",
      });
    }
    this.logger?.warn("MCP server ping failed", {
      ...this.connectionContext,
      error: error instanceof Error ? error.message : String(error),
      event: "mcp.server.ping.failed",
      mcpServerName: name,
      status: "failed",
      transport: record.config.type,
    });
    return false;
  }
}

export async function listTools(this: NodeMcpAdapter): Promise<McpToolDescriptor[]> {
  return Array.from(this.records.values()).flatMap((record) => record.tools);
}

export async function close(this: NodeMcpAdapter): Promise<void> {
  const startedAt = Date.now();
  const serverCount = this.records.size;
  for (const name of this.records.keys()) {
    this.nextConnectionGeneration(name);
  }
  await Promise.all(Array.from(this.records.keys()).map((name) => this.closeRecord(name)));
  this.records.clear();
  this.connectionDiagnosticByServer.clear();
  this.logger?.info("MCP adapter closed", {
    durationMs: Date.now() - startedAt,
    event: "mcp.adapter.closed",
    serverCount,
    status: "completed",
  });
}

export async function closeRecord(this: NodeMcpAdapter, name: string): Promise<void> {
  const record = this.records.get(name);
  if (!record) return;
  record.abortController?.abort(new Error(`MCP server ${name} connection closed`));
  if (!record.client && !record.transport) return;
  await this.closeClientAndTransport(name, record.client, record.transport);
}

export async function closeClientAndTransport(
  this: NodeMcpAdapter,
  name: string,
  client?: McpClient,
  transport?: McpTransport,
): Promise<void> {
  const startedAt = Date.now();
  const mcpTransportPid = getStdioTransportPid(transport);
  // 主动关闭前先摘掉 connection_lost 监听，避免正常回收被误报为意外断连。
  if (client) client.onclose = undefined;
  // MCP SDK close 只保证直接 stdio 子进程退出，npx/npm wrapper 拉起的 MCP server
  // 或 chrome-devtools-mcp watchdog 可能残留；这里先按进程树显式回收，再走 SDK close 清理协议状态。
  await this.terminateStdioProcessTree(name, transport);

  try {
    await client?.close();
  } catch (error) {
    this.logger?.debug("MCP client close failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "mcp.client.close.failed",
      mcpServerName: name,
    });
  }

  try {
    await transport?.close();
  } catch (error) {
    this.logger?.debug("MCP transport close failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "mcp.transport.close.failed",
      mcpServerName: name,
    });
  }
  if (
    this.connectionContext &&
    transport instanceof ProcessTreeStdioClientTransport &&
    !transport.processAlive
  ) {
    this.telemetry?.recordProcessClosed({
      connectionId: this.connectionContext.mcpConnectionId,
    });
  }
  this.logger?.info("MCP server closed", {
    ...this.connectionContext,
    durationMs: Date.now() - startedAt,
    event: "mcp.server.closed",
    mcpServerName: name,
    ...(mcpTransportPid != null ? { mcpTransportPid } : {}),
    status: "completed",
  });
}

export async function terminateStdioProcessTree(
  this: NodeMcpAdapter,
  name: string,
  transport?: McpTransport,
): Promise<void> {
  const pid = getStdioTransportPid(transport);
  if (pid == null) return;

  try {
    await terminateMcpStdioProcessTree(pid);
  } catch (error) {
    this.logger?.warn("MCP stdio process tree cleanup failed", {
      ...this.connectionContext,
      error: error instanceof Error ? error.message : String(error),
      event: "mcp.stdio.process_tree_cleanup.failed",
      mcpServerName: name,
      mcpTransportPid: pid,
      pid,
      status: "failed",
    });
  }
}
