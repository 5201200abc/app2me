import { readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MYCODE_RUNTIME_ENV_KEY, normalizeMyCodeRuntimeEnv } from "@mycode/shared";
import type { EnvRecord } from "./model-execution.js";
import type {
  AiSdkGenerateTextOptions,
  AiSdkStreamTextOptions,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";

// 生产环境 rollout 目录最多保留的 model-io 会话文件数。超出删最旧。
export const MAX_ROLLOUT_FILES = 3;

// 生产环境单个 session 的 model-io 文件硬上限。诊断日志不能因为无限增长影响 agent 主流程。
export const MAX_ROLLOUT_SESSION_BYTES = 64 * 1024 * 1024;

// 开发态保留更多上下文，但仍避免单个 debug 文件无限膨胀。
export const MAX_DEBUG_SESSION_BYTES = 256 * 1024 * 1024;

// 缓存缺失或文件超限后写 baseline 时，仅保留最近上下文，避免长 session 重启后再次写出巨型记录。
export const MAX_ROLLOUT_BASELINE_MESSAGES = 64;

export const MAX_DEBUG_BASELINE_MESSAGES = 256;

export const FINGERPRINT_STRING_LIMIT = 512;

export interface ModelIOCollectionState {
  count: number;
  firstFingerprint?: string;
  lastFingerprint?: string;
  sampleFingerprints?: string[];
}

export interface ModelIORequestCompactionState {
  bodyMessages?: ModelIOCollectionState;
  messages?: ModelIOCollectionState;
  sdkMessages?: ModelIOCollectionState;
}

export interface ModelIOCompactionState {
  request?: ModelIORequestCompactionState;
}

export const modelIOCompactionStates = new Map<string, ModelIOCompactionState>();

export function shouldRecordModelIO(env: EnvRecord): boolean {
  // 开发态与生产态都记录(分别落到 debug / rollout 目录);仅测试态(MYCODE_RUNTIME_ENV=test)不写,
  // 避免单测产生磁盘副作用。未设时按生产处理(记录到 rollout,带条数上限)。
  return normalizeRuntimeEnv(env) !== "test";
}

// 判定当前是否开发态,用于选择落盘目录(debug vs rollout)。
// 直接看 MYCODE_RUNTIME_ENV === "development";dev 桌面/CLI 启动时已注入该变量。
export function isDevelopmentModelIOEnv(env: EnvRecord): boolean {
  return normalizeRuntimeEnv(env) === "development";
}

export function buildFallbackRequestBodyFromOptions(input: {
  options: AiSdkGenerateTextOptions | AiSdkStreamTextOptions;
  resolved: ResolvedAiSdkModel;
  stream: boolean;
}): Record<string, unknown> {
  const options = input.options as Record<string, unknown>;
  return removeUndefined({
    // 失败路径经常拿不到 AI SDK 暴露的 raw request.body。此处记录送入
    // AI SDK 的完整 payload 快照，方便排查 provider 400 的 messages/tools 结构。
    bodySource: "ai_sdk_options",
    experimental_include: options.experimental_include,
    frequencyPenalty: options.frequencyPenalty,
    maxOutputTokens: options.maxOutputTokens,
    messages: options.messages,
    model: input.resolved.modelId,
    presencePenalty: options.presencePenalty,
    providerOptions: options.providerOptions,
    seed: options.seed,
    stopSequences: options.stopSequences,
    stream: input.stream,
    temperature: options.temperature,
    toolChoice: options.toolChoice,
    tools: options.tools,
    topK: options.topK,
    topP: options.topP,
  });
}

// 归一化 MYCODE_RUNTIME_ENV；未设置时返回 undefined,由调用方按生产处理。
export function normalizeRuntimeEnv(env: EnvRecord): string | undefined {
  return normalizeMyCodeRuntimeEnv(env[MYCODE_RUNTIME_ENV_KEY]);
}

// 保证目录下 model-io-*.jsonl 文件数不超过 maxFiles(为本次新 session 文件留位时传 maxFiles-1)。
export function rotateModelIOFiles(dir: string, maxFiles: number): void {
  let files: string[];
  try {
    files = readdirSync(dir).filter(
      (name) => name.startsWith("model-io-") && name.endsWith(".jsonl"),
    );
  } catch {
    return; // 目录刚创建/读取失败,无需淘汰
  }

  let removeCount = files.length - maxFiles;
  if (removeCount <= 0) {
    return;
  }

  const oldestFirst = files
    .map((name) => {
      try {
        return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
      } catch {
        return { name, mtimeMs: 0 };
      }
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => entry.name);
  for (const name of oldestFirst) {
    if (removeCount <= 0) break;
    const filePath = join(dir, name);
    try {
      rmSync(filePath, { force: true });
      modelIOCompactionStates.delete(filePath);
      removeCount -= 1;
    } catch {
      // 单个文件删除失败不阻断写入
    }
  }
}

// 仅保留文件名安全字符,其余折叠为 -,并限长避免触达 Windows 路径长度上限。
export function sanitizeFileSegment(value?: string): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// storage profile 回滚删除了自定义 CLI 根模块，遗留 import 会让 adapters 无法构建。
// 这里保持历史语义：开发态写 ~/.mycode/cli/debug，生产态写 ~/.mycode/cli/rollout。
export function getModelIOBaseDir(isDev: boolean): string {
  return join(homedir(), ".mycode", "cli", isDev ? "debug" : "rollout");
}

export function stringifyDebugRecord(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

export function readFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function prepareProductionRequestRecord(
  request: Record<string, unknown>,
  hasError: boolean,
): Record<string, unknown> {
  const next = { ...request };
  // 生产 rollout 只保留 canonical request.messages。sdkMessages 与 provider body.messages
  // 通常是同一上下文的重复拷贝，长会话下会把诊断文件和单次 stringify 放大数倍。
  delete next.sdkMessages;
  const body = asRecord(next.body);
  if (body && !hasError) {
    const nextBody = { ...body };
    delete nextBody.messages;
    next.body = nextBody;
  }
  return next;
}

export function prepareProductionResponseRecord(
  response: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...response };
  // response.body 在生产排障里价值低于 text/toolCalls/usage/finishReason，且可能包含 provider 原始大包。
  delete next.body;
  return next;
}

export function buildModelIOCompactionState(
  record: Record<string, unknown>,
): ModelIOCompactionState {
  const request = asRecord(record.request);
  if (!request) {
    return {};
  }

  return {
    request: buildRequestCompactionState(request),
  };
}

export function buildRequestCompactionState(
  request: Record<string, unknown>,
): ModelIORequestCompactionState {
  const body = asRecord(request.body);
  return {
    bodyMessages: buildCollectionState(body?.messages),
    messages: buildCollectionState(request.messages),
    sdkMessages: buildCollectionState(request.sdkMessages),
  };
}

export function buildCollectionState(value: unknown): ModelIOCollectionState | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return {
    count: value.length,
    firstFingerprint: fingerprintValue(value[0]),
    lastFingerprint: fingerprintValue(value[value.length - 1]),
    sampleFingerprints: fingerprintCollectionSamples(value),
  };
}

export function fingerprintCollectionSamples(value: unknown[], count = value.length): string[] {
  if (count <= 0) {
    return [];
  }
  // 常数级采样首/中/尾位置，避免把整段历史 stringify 成巨型字符串，同时降低中间历史变更被误判为 delta 的概率。
  const lastIndex = count - 1;
  const indexes = new Set([
    0,
    Math.floor(lastIndex * 0.25),
    Math.floor(lastIndex * 0.5),
    Math.floor(lastIndex * 0.75),
    lastIndex,
  ]);
  return [...indexes].map((index) => fingerprintValue(value[index]));
}

export function fingerprintValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return [
      "string",
      String(value.length),
      value.slice(0, FINGERPRINT_STRING_LIMIT),
      value.slice(-FINGERPRINT_STRING_LIMIT),
    ].join(":");
  }
  if (typeof value !== "object") {
    return `${typeof value}:${String(value)}`;
  }
  if (depth >= 3) {
    return Array.isArray(value) ? `array:${value.length}` : "object";
  }
  if (Array.isArray(value)) {
    return [
      "array",
      String(value.length),
      fingerprintValue(value[0], depth + 1),
      fingerprintValue(value[value.length - 1], depth + 1),
    ].join(":");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sampledKeys = keys.slice(0, 12);
  return [
    "object",
    String(keys.length),
    ...sampledKeys.map((key) => `${key}=${fingerprintValue(record[key], depth + 1)}`),
  ].join(":");
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
