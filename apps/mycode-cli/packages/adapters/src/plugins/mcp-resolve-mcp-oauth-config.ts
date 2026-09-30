import type { McpOAuthConfig } from "@mycode/contracts";
import { isRecord } from "./helpers.js";
import {
  type VariableContext,
  resolveTemplate,
  requireString,
} from "./mcp-load-plugin-mcp-server-definitions.js";

/**
 * 严格解析 `auth` 的实现已移到 mcp-official-auth.ts（mcp.ts 已到 max-lines 上限）。
 */
export function resolveMcpOAuthConfig(
  value: unknown,
  context: VariableContext,
): McpOAuthConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "client_credentials") {
    return {
      type: "client_credentials",
      clientId: resolveTemplate(
        requireString(value.clientId, "MCP OAuth client_credentials requires clientId"),
        context,
        { allowSensitive: false },
      ),
      clientSecret: resolveTemplate(
        requireString(value.clientSecret, "MCP OAuth client_credentials requires clientSecret"),
        context,
        { allowSensitive: true },
      ),
      ...(typeof value.clientName === "string"
        ? {
            clientName: resolveTemplate(value.clientName, context, { allowSensitive: false }),
          }
        : {}),
      ...(typeof value.scope === "string"
        ? {
            scope: resolveTemplate(value.scope, context, { allowSensitive: false }),
          }
        : {}),
    };
  }
  if (value.type === "authorization_code") {
    return {
      type: "authorization_code",
      ...(typeof value.clientId === "string"
        ? {
            clientId: resolveTemplate(value.clientId, context, { allowSensitive: false }),
          }
        : {}),
      ...(typeof value.clientSecret === "string"
        ? {
            clientSecret: resolveTemplate(value.clientSecret, context, { allowSensitive: true }),
          }
        : {}),
      ...(typeof value.clientName === "string"
        ? {
            clientName: resolveTemplate(value.clientName, context, { allowSensitive: false }),
          }
        : {}),
      ...(typeof value.redirectPath === "string"
        ? {
            redirectPath: resolveTemplate(value.redirectPath, context, { allowSensitive: false }),
          }
        : {}),
      ...(typeof value.scope === "string"
        ? {
            scope: resolveTemplate(value.scope, context, { allowSensitive: false }),
          }
        : {}),
    };
  }
  throw new Error(`Unsupported MCP OAuth type: ${String(value.type)}`);
}
