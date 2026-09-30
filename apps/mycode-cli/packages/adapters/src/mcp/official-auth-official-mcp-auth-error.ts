import {
  isOfficialMcpReservedHeaderName,
  type McpServerFailureKind,
  type OfficialMcpAuthFailureKind,
} from "@mycode/shared";
import type {
  Logger,
  McpOfficialProvenance,
  OfficialMcpAuthHeadersPort,
  OfficialMcpTrustedOriginRegistry,
} from "@mycode/contracts";

/** 由 adapter 抛出的、带稳定分类的官方鉴权错误。禁止调用方按 message 文本分流。 */
export class OfficialMcpAuthError extends Error {
  constructor(
    readonly kind: OfficialMcpAuthFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "OfficialMcpAuthError";
  }
}

/**
 * 关联 id 的 header 名。
 *
 * 用途有两个，都**不是**发送：
 * 1. 从请求头里剥离，避免插件静态配置把这两个可观测通道注入官方端点；
 * 2. 从**响应头**读取服务端自己生成的 request id，记入日志用于端到端对账。
 *
 * 客户端不发送这两个头：服务端始终自行生成请求 id、不读入站值，发了不会被任何人读取。
 */
export const REQUEST_ID_HEADER = "x-request-id";

export const TRACE_ID_HEADER = "x-trace-id";

export interface CreateOfficialMcpAuthFetchInput {
  authHeadersPort?: OfficialMcpAuthHeadersPort;
  baseFetch: typeof globalThis.fetch;
  logger?: Logger;
  /**
   * 分类上报钩子。SDK 的 version negotiation 会把本模块抛出的 OfficialMcpAuthError
   * 重新包装成普通 Error（message 保留、对象身份丢失），因此 instanceof 在上层不可靠。
   * 分类必须在抛出点上报，不能靠上层解析错误文本判断（项目规范禁止按错误文本分流）。
   */
  onAuthFailure?: (kind: OfficialMcpAuthFailureKind) => void;
  /**
   * 服务端 request id 的上报钩子，用于把它关联回具体一次 `tools/call`。
   *
   * 只有这一层能看到响应头：wrapper 之上是 MCP SDK，它只把 JSON-RPC 结果交给 adapter。
   * 因此 in-band 失败（HTTP 200 + `isError: true`，如配额耗尽）想带上 request id，
   * 必须由这里把它送出去，再由 adapter 按 span 关联。
   */
  onServerResponse?: (response: OfficialMcpServerResponseInfo) => void;
  official: McpOfficialProvenance;
  serverName: string;
  trustedOrigins: OfficialMcpTrustedOriginRegistry;
  /** MCP endpoint URL；Origin 校验以每次请求的实际 URL 为准，不只在连接时校验一次。 */
  url: string;
  workspaceIdentity?: string;
  workspacePath?: string;
}

/** 一次官方 MCP 响应中可用于关联的非敏感事实。不含 body、不含任何 header 值。 */
export interface OfficialMcpServerResponseInfo {
  failureKind?: McpServerFailureKind;
  httpStatus: number;
  rpcMethod?: string;
  rpcToolName?: string;
  /** 服务端自行生成的 `x-request-id`；无 HTTP response 时缺失且绝不伪造。 */
  serverRequestId?: string;
  /** 发起该请求的 tool call span。adapter 用它把 request id 关联回具体一次调用。 */
  spanId?: string;
  traceId?: string;
}

export const MAX_DIAGNOSTIC_RESPONSE_BYTES = 64 * 1024;

export async function classifyOfficialMcpResponse(
  response: Response,
): Promise<McpServerFailureKind | undefined> {
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "server_internal_error";

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return response.ok ? undefined : "connection_failed";
  }
  const text = await readBoundedResponseText(response, MAX_DIAGNOSTIC_RESPONSE_BYTES);
  if (!text) return response.ok ? undefined : "connection_failed";
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response.ok ? undefined : "connection_failed";
    }
    const record = parsed as Record<string, unknown>;
    if (record["code"] === 3001) return "server_not_found";
    if (record["code"] === 1000) return "server_unavailable";
    if (record["jsonrpc"] === "2.0" && record["error"] !== undefined) {
      const rpcError = record["error"];
      if (rpcError && typeof rpcError === "object" && !Array.isArray(rpcError)) {
        const code = (rpcError as Record<string, unknown>)["code"];
        if (code === 1006) return "not_authenticated";
        if (code === 3101) return "coding_plan_required";
      }
      return "protocol_error";
    }
  } catch {
    return response.ok ? undefined : "connection_failed";
  }
  return response.ok ? undefined : "connection_failed";
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const declaredLength = numericHeader(response.headers.get("content-length"));
  if (declaredLength !== undefined && declaredLength > maxBytes) return undefined;
  const body = response.clone().body;
  if (!body) return undefined;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 合并静态 header 与身份头。身份头一律覆盖（set），并剔除来源侧残留的保留头
 * ——parse 期已拦截静态保留头，这里是合并点的二次强制。
 * 不触碰 mcp-session-id / mcp-protocol-version / accept / content-type。
 */
export function mergeOfficialAuthHeaders(
  incoming: HeadersInit | undefined,
  authHeaders: Record<string, string>,
): Headers {
  const merged = new Headers();
  const authHeaderNames = new Set(Object.keys(authHeaders).map((name) => name.toLowerCase()));
  new Headers(incoming ?? {}).forEach((value, name) => {
    const normalized = name.toLowerCase();
    // 身份头稍后统一写入；其余保留头（如 authProvider 写入的 Authorization）直接丢弃。
    if (authHeaderNames.has(normalized)) return;
    if (
      isOfficialMcpReservedHeaderName(normalized) &&
      normalized !== "mcp-session-id" &&
      normalized !== "mcp-protocol-version"
    ) {
      return;
    }
    merged.set(name, value);
  });
  for (const [name, value] of Object.entries(authHeaders)) {
    merged.set(name, value);
  }
  return merged;
}

export function resolveRequestUrl(resource: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof resource === "string") return resource;
  if (resource instanceof URL) return resource.toString();
  return resource.url;
}

export function safeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    // 带凭证的 URL 与其 origin 不是同一信任面，直接判为不可信。
    if (url.username !== "" || url.password !== "") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/** 服务端在响应头里回带的 request id。缺失时返回 undefined。 */
export function readServerRequestId(response: Response): string | undefined {
  const value = response.headers.get(REQUEST_ID_HEADER)?.trim();
  return value ? value : undefined;
}

/**
 * 把服务端 request id 附到分类错误的 message 上。
 *
 * tool call 分类错误直接向上展示，使用紧凑的 `message - requestId` 形态。连接期 request id
 * 由 adapter 的结构化 status diagnostic 统一拼接，避免 SDK 包装前后重复。
 */
export function withServerRequestId(message: string, response: Response): string {
  const requestId = readServerRequestId(response);
  return requestId ? `${message} - ${requestId}` : message;
}

/** 请求路径（不含 query）。query 可能带用户内容，因此丢弃。 */
export function safePath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "(unparsable)";
  }
}

export function byteLength(body: unknown): number | undefined {
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body instanceof Uint8Array) return body.byteLength;
  return undefined;
}

export function numericHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 从 JSON-RPC 请求体里取出**结构性**字段用于关联日志：method / id / tools\_call 的工具名 /
 * `_meta` 里的 trace\_id。
 * 刻意不取 `params.arguments`——那里是用户输入（如搜索词），不属于"没那么敏感"的范畴。
 *
 * trace\_id 仅在 `tools/call` 上存在：`initialize` / `tools/list` 由 SDK 在建连阶段发出，
 * 没有 `_meta`，因此那两个请求只有 request id、没有 trace id。这是预期的，不是缺陷。
 */
export function describeJsonRpc(body: unknown): {
  id?: number | string;
  method?: string;
  spanId?: string;
  toolName?: string;
  traceId?: string;
} {
  if (typeof body !== "string" || body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const method = typeof record.method === "string" ? record.method : undefined;
    const id =
      typeof record.id === "number" || typeof record.id === "string" ? record.id : undefined;
    const params = isPlainRecord(record.params) ? record.params : undefined;
    const toolName = params && typeof params.name === "string" ? params.name : undefined;
    // mcpRequestMeta 把 trace 写在 params._meta 上（同时有扁平键与 com.mycode/ 命名空间键）。
    const meta = params && isPlainRecord(params._meta) ? params._meta : undefined;
    const traceId = meta && typeof meta.trace_id === "string" ? meta.trace_id : undefined;
    // span 才是"一次 tool call"的粒度：traceId 覆盖整个顶层 session，同一 session 里的
    // 多次调用共用它，用它做关联会串号。
    const spanId = meta && typeof meta.span_id === "string" ? meta.span_id : undefined;
    return {
      ...(id !== undefined ? { id } : {}),
      ...(method ? { method } : {}),
      ...(spanId ? { spanId } : {}),
      ...(toolName ? { toolName } : {}),
      ...(traceId ? { traceId } : {}),
    };
  } catch {
    return {};
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 身份头的**非敏感摘要**：只有名字、是否成对、以及 targetType 的枚举值。
 * 绝不输出 Authorization 或 api-key 的值，连截断值也不输出——日志留存周期不受控。
 */
export function describeAbortSignal(signal: AbortSignal | null | undefined): string {
  if (!signal) return "none";
  return signal.aborted ? "already-aborted" : "armed";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 丢弃 body 失败不影响分类结论。
  }
}
