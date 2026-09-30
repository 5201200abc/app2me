import { downloadMyCodeBuiltinRelease, type MyCodeBuiltinRelease } from "@mycode/provider-node";
import type { ApiClient } from "@mycode/shared";

interface FetchMyCodeBuiltinRemoteReleaseOptions {
  readonly apiClient: ApiClient;
  readonly endpointOrigin: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly signal?: AbortSignal;
}

/** Services 仅注入既有网络装配；URL、预算与 Release 校验由 provider-node 唯一实现。 */
export async function fetchMyCodeBuiltinRemoteRelease(
  options: FetchMyCodeBuiltinRemoteReleaseOptions,
): Promise<MyCodeBuiltinRelease | null> {
  return downloadMyCodeBuiltinRelease({
    endpointOrigin: options.endpointOrigin,
    appVersion: options.appVersion,
    platform: options.platform,
    signal: options.signal,
    request: (url, init) => options.apiClient.request(url, init),
  });
}
