import type { ModelTextResult } from "@mycode/contracts";
import { redactAnthropicRequestMetadata } from "./anthropic-request-metadata.js";
import { normalizeSources, normalizeToolResults, normalizeUsage } from "./runner-normalization.js";
import { stringMetadata } from "./runner-record.js";
import type {
  AiSdkGenerateTextResult,
  AiSdkModelTextRequest,
  AiSdkStreamTextOptions,
  AiSdkStreamTextResult,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";
import {
  resolveFailedStreamModelIOAggregate,
  resolveStreamModelIOAggregate,
  modelIOReasoningText,
} from "./runner-debug-record-generate-text-debug.js";
import { buildFallbackRequestBodyFromOptions } from "./runner-debug-should-record-model-io.js";
import {
  writeModelIODebugRecord,
  serializeError,
} from "./runner-debug-write-model-iodebug-record.js";

/**
 * 流式请求的 model I/O 记录。
 *
 * 背景（bug：开发态桌面 agent 始终走流式，model-io 一直为空）：
 * 只在非流式 `runGenerateText` 里写 model-io 会让桌面/协议端默认 `modelStreaming: "on"` 的
 * 每个 turn（`streamText`）即便 MYCODE_RUNTIME_ENV=development 也从不落盘。流式路径同样要记录。
 *
 * 与 generate 路径的关键差异：StreamTextResult 的 text/toolResults/sources/response 等聚合字段是 **promise**，
 * 必须等 fullStream 读完后再 await；toolResults/sources 的归一化期望数组，
 * 所以先解析聚合 promise，再用合成对象处理。toolCalls 则直接复用 assembler 的归一化快照。
 * 任何失败都不得影响模型请求路径。
 */
export async function recordStreamTextDebug(input: {
  attempt: number;
  debugDir?: string;
  error?: unknown;
  isDev: boolean;
  modelIoFullRetentionEnabled: boolean;
  normalizedToolCalls: ModelTextResult["toolCalls"];
  options: AiSdkStreamTextOptions;
  recordModelIO: boolean;
  request: AiSdkModelTextRequest;
  requestId: string;
  resolved: ResolvedAiSdkModel;
  result?: AiSdkStreamTextResult;
  startedAt: number;
}): Promise<void> {
  if (!input.recordModelIO) {
    return;
  }

  try {
    // 成功路径下解析完整聚合结果；失败路径只读取 request/response 元数据，且必须限时——
    // 流中途被 abort（用户 Stop / idle timeout）后 AI SDK 的聚合 promise 永不 settle。
    const aggregate = input.result
      ? input.error
        ? await resolveFailedStreamModelIOAggregate(input.result, input.request.abortSignal)
        : await resolveStreamModelIOAggregate(input.result)
      : undefined;
    const completedAt = Date.now();
    const metadata = input.request.metadata ?? {};
    const requestBody =
      input.resolved.rawRequestBodyCapture?.body ??
      aggregate?.requestBody ??
      (input.error
        ? buildFallbackRequestBodyFromOptions({
            options: input.options,
            resolved: input.resolved,
            stream: true,
          })
        : undefined);
    const syntheticResult = {
      toolResults: aggregate?.toolResults,
      sources: aggregate?.sources,
    } as unknown as AiSdkGenerateTextResult;

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
        response: aggregate
          ? {
              body: aggregate.responseBody,
              finishReason: aggregate.finishReason,
              headers: aggregate.responseHeaders,
              modelId: aggregate.responseModelId,
              providerMetadata: aggregate.providerMetadata,
              reasoningText: modelIOReasoningText(aggregate.reasoning),
              responseId: aggregate.responseId,
              text: aggregate.text,
              // assembler 是流式参数归一化的唯一所有者；
              // model-io 复用其快照，避免二次解析、重复 warn 和诊断结果漂移。
              toolCalls: input.normalizedToolCalls,
              toolResults: normalizeToolResults(syntheticResult, input.normalizedToolCalls),
              sources: normalizeSources(syntheticResult),
              usage: normalizeUsage(aggregate.usage),
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
  } catch {
    // Model I/O debug logging must never affect the model request path.
  }
}

export { shouldRecordModelIO } from "./runner-debug-should-record-model-io.js";
export { isDevelopmentModelIOEnv } from "./runner-debug-should-record-model-io.js";
export { recordGenerateTextDebug } from "./runner-debug-record-generate-text-debug.js";
