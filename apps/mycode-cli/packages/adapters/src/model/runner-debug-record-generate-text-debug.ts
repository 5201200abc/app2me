import type { ModelTextResult } from "@mycode/contracts";
import { redactAnthropicRequestMetadata } from "./anthropic-request-metadata.js";
import { getGenerateTextResultMetadata } from "./runner-diagnostics.js";
import {
  normalizeReasoning,
  normalizeSources,
  normalizeToolResults,
  normalizeUsage,
} from "./runner-normalization.js";
import { stringMetadata } from "./runner-record.js";
import type {
  AiSdkGenerateTextOptions,
  AiSdkGenerateTextResult,
  AiSdkModelTextRequest,
  AiSdkStreamTextResult,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";
import { buildFallbackRequestBodyFromOptions } from "./runner-debug-should-record-model-io.js";
import {
  writeModelIODebugRecord,
  serializeError,
} from "./runner-debug-write-model-iodebug-record.js";

export function recordGenerateTextDebug(input: {
  attempt: number;
  debugDir?: string;
  error?: unknown;
  isDev: boolean;
  modelIoFullRetentionEnabled: boolean;
  normalizedToolCalls: ModelTextResult["toolCalls"];
  options: AiSdkGenerateTextOptions;
  recordModelIO: boolean;
  request: AiSdkModelTextRequest;
  requestId: string;
  resolved: ResolvedAiSdkModel;
  result?: AiSdkGenerateTextResult;
  startedAt: number;
}): void {
  if (!input.recordModelIO) {
    return;
  }

  const completedAt = Date.now();
  const resultWithMetadata = getGenerateTextResultMetadata(input.result);
  const metadata = input.request.metadata ?? {};
  const requestBody =
    input.resolved.rawRequestBodyCapture?.body ??
    resultWithMetadata?.request?.body ??
    (input.error
      ? buildFallbackRequestBodyFromOptions({
          options: input.options,
          resolved: input.resolved,
          stream: false,
        })
      : undefined);

  writeModelIODebugRecord(
    {
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - input.startedAt,
      error: input.error ? serializeError(input.error) : undefined,
      requestId: input.requestId,
      attempt: input.attempt,
      model: {
        modelId: input.resolved.modelId,
        providerId: input.resolved.providerId,
      },
      request: {
        body: redactAnthropicRequestMetadata(requestBody),
        headers: input.options.headers,
        maxOutputTokens: input.options.maxOutputTokens,
        messages: input.request.messages,
        providerOptions: input.request.providerOptions,
        sdkMessages: input.options.messages,
        temperature: input.request.temperature,
        toolChoice: input.request.toolChoice,
        toolNames: input.request.tools?.map((toolContract) => toolContract.name) ?? [],
      },
      response: input.result
        ? {
            body: resultWithMetadata?.response?.body,
            finishReason: input.result.finishReason,
            headers: resultWithMetadata?.response?.headers,
            modelId: resultWithMetadata?.response?.modelId,
            providerMetadata: input.result.providerMetadata,
            // 运行结果已有 reasoning，但 model-io 过去只记录 text，
            // 导致调用轨迹无法得到 response.reasoningText，始终不显示思考过程。
            reasoningText: modelIOReasoningText(input.result.reasoning),
            responseId: resultWithMetadata?.response?.id,
            text: input.result.text,
            toolCalls: input.normalizedToolCalls,
            toolResults: normalizeToolResults(input.result, input.normalizedToolCalls),
            sources: normalizeSources(input.result),
            usage: normalizeUsage(input.result.totalUsage ?? input.result.usage),
          }
        : undefined,
      sessionId: stringMetadata(metadata.sessionId),
      querySource: stringMetadata(metadata.querySource),
      startedAt: new Date(input.startedAt).toISOString(),
      traceId: stringMetadata(metadata.traceId),
      turnId: stringMetadata(metadata.turnId),
      type: "model_io",
    },
    input.debugDir,
    input.isDev,
    input.modelIoFullRetentionEnabled,
  );
}

export interface StreamModelIOAggregate {
  finishReason?: unknown;
  providerMetadata?: unknown;
  reasoning?: unknown;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: unknown;
  responseId?: unknown;
  responseModelId?: unknown;
  sources?: unknown;
  text?: unknown;
  toolResults?: unknown;
  usage?: Parameters<typeof normalizeUsage>[0];
}

// StreamTextResult 的聚合字段都是 promise，逐个 best-effort 解析(失败回退 undefined)。
export async function resolveStreamModelIOAggregate(
  result: AiSdkStreamTextResult,
): Promise<StreamModelIOAggregate> {
  const streamResult = result as unknown as {
    text?: Promise<unknown>;
    reasoning?: Promise<unknown>;
    finishReason?: Promise<unknown>;
    totalUsage?: Promise<unknown>;
    usage?: Promise<unknown>;
    toolResults?: Promise<unknown>;
    sources?: Promise<unknown>;
    providerMetadata?: Promise<unknown>;
    request?: Promise<unknown>;
    response?: Promise<unknown>;
  };

  const [
    text,
    reasoning,
    finishReason,
    totalUsage,
    usage,
    toolResults,
    sources,
    providerMetadata,
    request,
    response,
  ] = await Promise.all([
    settleModelIOValue(streamResult.text),
    settleModelIOValue(streamResult.reasoning),
    settleModelIOValue(streamResult.finishReason),
    settleModelIOValue(streamResult.totalUsage),
    settleModelIOValue(streamResult.usage),
    settleModelIOValue(streamResult.toolResults),
    settleModelIOValue(streamResult.sources),
    settleModelIOValue(streamResult.providerMetadata),
    settleModelIOValue(streamResult.request),
    settleModelIOValue(streamResult.response),
  ]);

  const requestRecord = (request ?? undefined) as { body?: unknown } | undefined;
  const responseRecord = (response ?? undefined) as
    | { id?: unknown; modelId?: unknown; headers?: unknown; body?: unknown }
    | undefined;

  return {
    text,
    reasoning,
    finishReason,
    usage: (totalUsage ?? usage) as StreamModelIOAggregate["usage"],
    toolResults,
    sources,
    providerMetadata,
    requestBody: requestRecord?.body,
    responseBody: responseRecord?.body,
    responseHeaders: responseRecord?.headers,
    responseId: responseRecord?.id,
    responseModelId: responseRecord?.modelId,
  };
}

export function modelIOReasoningText(reasoning: unknown): string | undefined {
  if (!Array.isArray(reasoning)) {
    return undefined;
  }

  const text = normalizeReasoning(reasoning)
    ?.map((part) => part.text)
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  return text && text.length > 0 ? text : undefined;
}

// 流中途被 abort 后，AI SDK 的 request/response 聚合 promise 既不 resolve 也不 reject
// （只有流正常读完或流级报错才会 settle），无限 await 会把 runner-stream 的 catch 挂死，
// turn 永不结束、activeAbortController 永不释放，session 从此拒绝一切新 prompt。
// 诊断记录是 best-effort：调用方已 abort 时直接跳过聚合，其余失败限时等待。
export const FAILED_STREAM_AGGREGATE_TIMEOUT_MS = 1_000;

export async function resolveFailedStreamModelIOAggregate(
  result: AiSdkStreamTextResult,
  abortSignal?: AbortSignal,
): Promise<StreamModelIOAggregate> {
  if (abortSignal?.aborted) {
    // 用户 Stop：让失败路径立即走完，request body 由 fallback 快照兜底。
    return {};
  }
  const streamResult = result as unknown as {
    request?: Promise<unknown>;
    response?: Promise<unknown>;
  };
  const [request, response] = await Promise.all([
    settleModelIOValueWithTimeout(streamResult.request, FAILED_STREAM_AGGREGATE_TIMEOUT_MS),
    settleModelIOValueWithTimeout(streamResult.response, FAILED_STREAM_AGGREGATE_TIMEOUT_MS),
  ]);
  const requestRecord = (request ?? undefined) as { body?: unknown } | undefined;
  const responseRecord = (response ?? undefined) as
    | { id?: unknown; modelId?: unknown; headers?: unknown; body?: unknown }
    | undefined;

  return {
    requestBody: requestRecord?.body,
    responseBody: responseRecord?.body,
    responseHeaders: responseRecord?.headers,
    responseId: responseRecord?.id,
    responseModelId: responseRecord?.modelId,
  };
}

export async function settleModelIOValue<T>(
  value: Promise<T> | T | undefined,
): Promise<T | undefined> {
  try {
    return await value;
  } catch {
    return undefined;
  }
}

// 用户 stop / v4 sendQueuedNow 抢占会 abort 当前流式请求；此时
// AI SDK StreamTextResult 的 request/response 聚合 promise 永不 settle——流被中途放弃，
// 聚合要等 fullStream 关闭才 resolve，而关闭 iterator 的 finally（runner-stream.ts）
// 又排在本 await 之后，形成循环等待。settleModelIOValue 只兜 reject 不兜「不 settle」，
// 导致 runStreamText 的 catch 永远不结束：TurnCancelled 无法上抛、turn 永不收口、
// record.activeAbortController 不释放、UI 的 stop（canStop）永久失效
// （e2e 复现：conversation-session-v4-vertical-slice / v4-sendnow）。
// 失败路径的 model-io 记录必须有界等待：超时按「值不可得」处理，绝不阻塞错误传播。
export async function settleModelIOValueWithTimeout<T>(
  value: Promise<T> | T | undefined,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    });
    return await Promise.race([settleModelIOValue(value), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
