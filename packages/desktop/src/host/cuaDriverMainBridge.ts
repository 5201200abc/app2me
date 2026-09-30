import { randomUUID } from "node:crypto";
import {
  HostResponseTypes,
  isRemoteWorkspaceIdentity,
  type CuaDriverOperation,
  type CuaDriverResult,
  type hostCuaDriverRequestSchema,
} from "@mycode/shared";
import type { z } from "zod";
import type {
  CuaProductMcpServerResolver,
  CuaProductMcpServerResolverContext,
} from "@mycode/mycode-cua/broker/server";
import type { ICuaPermissionService } from "@mycode/services";

type Request = z.infer<typeof hostCuaDriverRequestSchema>;
const SERVER_NAME = "cua_driver";

export function createCuaDriverMainBridge(deps: {
  postToMain(message: Request): void;
  isEnabled(context?: CuaProductMcpServerResolverContext): boolean | Promise<boolean>;
  hasActiveTurn(): boolean;
  onUnavailable?(error: Error): void;
}) {
  const pending = new Map<
    string,
    {
      resolve(result: CuaDriverResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let disposed = false;
  const injectedServers = new WeakSet<object>();
  const isRemote = (context?: CuaProductMcpServerResolverContext) =>
    Boolean(
      context?.remoteSessionId ||
      isRemoteWorkspaceIdentity(context?.workspaceIdentity?.trim() ?? ""),
    );
  function request(
    operation: CuaDriverOperation,
    context?: CuaProductMcpServerResolverContext,
  ): Promise<CuaDriverResult> {
    if (disposed) return Promise.reject(new Error("Cua Driver bridge disposed"));
    if (isRemote(context))
      return Promise.reject(new Error("Cua Driver is unavailable for remote workspaces"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Cua Driver Main request timed out"));
      }, 15_000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        deps.postToMain({
          type: HostResponseTypes.CuaDriverRequest,
          requestId,
          operation,
          ...(context?.workspacePath ? { workspacePath: context.workspacePath } : {}),
          ...(context?.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
        });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  const restart = async (context?: CuaProductMcpServerResolverContext) => {
    if (deps.hasActiveTurn()) throw new Error("Cannot restart Cua Driver during an active turn");
    const result = await request("restart", context);
    if (result.kind !== "restarted")
      throw new Error(result.kind === "error" ? result.message : "Invalid restart result");
  };
  const resolver: CuaProductMcpServerResolver = {
    async resolveMcpServers(servers, context) {
      if (isRemote(context) || !(await deps.isEnabled(context))) return servers;
      if (disposed) throw new Error("Cua Driver bridge disposed");
      const rest = servers?.filter((server) => !injectedServers.has(Object(server))) ?? [];
      // 名字不是所有权凭证；同名用户配置不能被当作上次注入的连接删除。
      if (rest.some((server) => (server as { name?: string })?.name === SERVER_NAME)) {
        deps.onUnavailable?.(new Error("User MCP server name conflicts with cua_driver"));
        return servers;
      }
      // 空 MCP 列表也需要注入；每次从 Main 取得当前代际，不能复用重启前的 socket。
      const result = await request("connect", context);
      if (result.kind === "error") {
        deps.onUnavailable?.(new Error(result.message));
        return servers ? rest : undefined;
      }
      if (result.kind !== "connection") throw new Error("Invalid Cua Driver connection result");
      const server = {
        name: SERVER_NAME,
        command: result.command,
        args: result.args,
        env: Object.entries(result.env).map(([name, value]) => ({ name, value })),
        protocolVersion: "legacy",
        isolation: "session",
      };
      injectedServers.add(server);
      return [...rest, server as unknown as NonNullable<typeof servers>[number]];
    },
    restart: () => restart(),
    restartAfterPermissionGrant: () => restart(),
  };
  const permissionService: ICuaPermissionService = {
    async getStatus(workspacePath, workspaceIdentity) {
      const result = await request("status", { workspacePath, workspaceIdentity });
      if (result.kind !== "status")
        return {
          available: false,
          reason: result.kind === "error" ? result.message : "Invalid permission result",
        };
      // Main 的实际应用名决定授权主体；授权布尔值不等于已执行 AX/截图功能探针。
      return {
        grantOwner: result.grantOwner,
        grantOwnerDisplayName: result.grantOwner,
        accessibility: result.accessibility ? "granted" : "denied",
        screenRecording: result.screenRecording ? "granted" : "denied",
      };
    },
    async restartHelper(workspacePath, workspaceIdentity) {
      try {
        await restart({ workspacePath, workspaceIdentity });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return {
    resolver,
    permissionService,
    handleResult(message: { requestId: string; result: CuaDriverResult }) {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      entry.resolve(message.result);
    },
    dispose() {
      disposed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Cua Driver bridge disposed"));
      }
      pending.clear();
    },
  };
}
