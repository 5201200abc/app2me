import {
  isRemoteWorkspaceIdentity,
  resolveWorkspaceKey,
  mycodeSessionResolveMcpServersParamsSchema,
  mycodeSessionResolveMcpServersResultSchema,
} from "@mycode/shared";
import type { CuaProductMcpServerResolver } from "#src/cua-permission-broker/index.js";
import type { MyCodeAgentWorkspaceTarget } from "./mycodeAgent.js";

export async function resolveSessionMcpServers(input: {
  params: unknown;
  workspace: MyCodeAgentWorkspaceTarget;
  resolver?: Pick<CuaProductMcpServerResolver, "resolveMcpServers">;
}) {
  const params = mycodeSessionResolveMcpServersParamsSchema.parse(input.params);
  const { workspace } = input;
  // 请求不能把同路径的另一个 identity 或远端会话伪装成本机；以 Agent 连接为准。
  if (
    params.workspace.workspacePath !== workspace.workspacePath ||
    resolveWorkspaceKey(params.workspace) !== resolveWorkspaceKey(workspace) ||
    (params.workspace.remoteSessionId?.trim() || undefined) !==
      (workspace.remoteSessionId?.trim() || undefined)
  ) {
    throw new Error("Session MCP workspace mismatch");
  }
  const remote = Boolean(
    workspace.remoteSessionId ||
    isRemoteWorkspaceIdentity(workspace.workspaceIdentity?.trim() || ""),
  );
  const mcpServers =
    !remote && input.resolver
      ? await input.resolver.resolveMcpServers(params.mcpServers, { ...workspace })
      : params.mcpServers;
  return mycodeSessionResolveMcpServersResultSchema.parse(
    mcpServers === undefined ? {} : { mcpServers },
  );
}
