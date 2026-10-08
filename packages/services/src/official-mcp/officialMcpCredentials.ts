import type {
  OfficialMcpAuthFailureReason,
  MyCodeProviderAccountAccess,
  MyCodeAccountAccess,
} from "@mycode/shared";
import type { ModelSelectionView } from "@mycode/provider";

interface OfficialMcpCredentialResolverDeps {
  accountRequestAuthService: {
    resolveAccessCurrent(access: MyCodeProviderAccountAccess): Promise<MyCodeAccountAccess | null>;
  };
  credentialService: { load(key: string): Promise<string | null | undefined> };
  modelSelectionService: {
    getView(): Promise<ModelSelectionView>;
  };
}

export type OfficialMcpPlanScope =
  | { targetType: "PERSONAL" }
  | { targetType: "TEAM"; organizationId: string; projectId: string };

export type OfficialMcpWireScope = OfficialMcpPlanScope | null;

/** 解析成功后的凭证快照。仅在 host/service 进程内存活，脱敏后才允许过 RPC。 */
export interface OfficialMcpCredentialSnapshot {
  jwt: string;
  /**
   * MaaS 登录 JWT（`oauth:<family>:access_token` 的原文，**不带 Bearer 前缀**）。
   * 前缀在 buildOfficialMcpAuthHeaders 里加，与 reset / usage 通道的既有约定一致。
   */
  codingPlanAuthorization?: string;
  providerFamily: string;
  /** 当前选中连接的产品/额度归属；畸形旧 Team key 无法精确归属时为 null。 */
  planScope: OfficialMcpPlanScope | null;
  /** 历史协议兼容字段；不再发送账号身份。 */
  wireScope: OfficialMcpWireScope;
}

export type OfficialMcpCredentialOutcome =
  | { ok: true; snapshot: OfficialMcpCredentialSnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

/** 原账号服务已经移除；禁止读取或导出历史凭据。 */
export async function resolveOfficialMcpCredentials(
  _deps: OfficialMcpCredentialResolverDeps,
): Promise<OfficialMcpCredentialOutcome> {
  return { ok: false, reason: "official_auth_unavailable" };
}
export function buildOfficialMcpAuthHeaders(
  _snapshot: OfficialMcpCredentialSnapshot,
): Record<string, string> {
  return {};
}

interface OfficialMcpAuthHeadersRequestContext {
  mcpKey: string;
  pluginId: string;
  targetOrigin: string;
  workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
}

type OfficialMcpAuthHeadersOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

export function createOfficialMcpAuthHeadersResolver(_deps: OfficialMcpCredentialResolverDeps): {
  resolveHeaders(
    request?: OfficialMcpAuthHeadersRequestContext,
  ): Promise<OfficialMcpAuthHeadersOutcome>;
} {
  return {
    async resolveHeaders() {
      return { ok: false, reason: "official_auth_unavailable" };
    },
  };
}
