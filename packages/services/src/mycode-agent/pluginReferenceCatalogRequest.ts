import {
  mycodeProtocolMethods,
  mycodePluginsReferenceCatalogResultSchema,
  type MyCodePluginsReferenceCatalogParams,
} from "@mycode/shared";
import type { MyCodeProtocolClient } from "#src/mycode-agent/mycodeProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<MyCodeProtocolClient, "request">,
  params: MyCodePluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      mycodeProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      mycodePluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      mycodeProtocolMethods.pluginsReferenceCatalog,
      params,
      mycodePluginsReferenceCatalogResultSchema,
    );
  }
}
