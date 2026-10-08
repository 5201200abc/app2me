import {
  mycodeProtocolMethods,
  MYCODE_SESSION_MCP_RESOLUTION_ENV_KEY,
  mycodeSessionResolveMcpServersResultSchema,
  type MyCodeProtocolMcpServer,
  type MyCodeWorkspaceRef,
} from "@mycode/shared";
import type { MyCodeProtocolAgentServerContext } from "./server-types.js";

export async function resolveProtocolSessionMcpServers(
  context: Pick<MyCodeProtocolAgentServerContext, "requestClient">,
  workspace: MyCodeWorkspaceRef,
  mcpServers?: MyCodeProtocolMcpServer[],
  env?: NodeJS.ProcessEnv,
) {
  if (env?.[MYCODE_SESSION_MCP_RESOLUTION_ENV_KEY] !== "1") return mcpServers;
  // V4 create 和冷恢复都绕过旧 session service；必须在公共初始化边界取本代际连接。
  const result = await context.requestClient(
    mycodeProtocolMethods.interactionResolveSessionMcpServers,
    { workspace, ...(mcpServers === undefined ? {} : { mcpServers }) },
    mycodeSessionResolveMcpServersResultSchema,
  );
  return result.mcpServers;
}
