import type { DatabaseSync } from "node:sqlite";
import type { ModelUsageRecord } from "@mycode/contracts";
import { encodeJson } from "../json.js";

export const USAGE_RETENTION_DAYS = 30;

export const USAGE_RETENTION_MS = USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export async function recordModelUsage(db: DatabaseSync, input: ModelUsageRecord): Promise<void> {
  const computedTotalTokens =
    input.computedTotalTokens ??
    inputSideTokensFromNormalizedUsage(
      input.inputTokens,
      input.cacheCreationInputTokens,
      input.cacheReadInputTokens,
    ) + integer(input.outputTokens);

  // 数据库沿用 0010 创建的历史列名；领域层使用更准确的 reasoningLevel。
  db.prepare(
    `
      insert into model_usage (
        id,
        logical_request_id,
        attempt_index,
        session_id,
        turn_id,
        trace_id,
        span_id,
        assistant_message_id,
        parent_user_message_id,
        query_source,
        provider_id,
        model_id,
        variant,
        agent,
        mode,
        task_type,
        status,
        started_at,
        first_token_at,
        completed_at,
        duration_ms,
        time_to_first_token_ms,
        finish_reason,
        tool_call_count,
        input_tokens,
        output_tokens,
        reasoning_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        provider_total_tokens,
        computed_total_tokens,
        retry_count,
        retryable,
        cancelled_by_user,
        context_exceeded,
        error_type,
        error_code,
        error_message,
        raw_usage_json,
        provider_metadata_json
      )
      values (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      on conflict(id) do update set
        logical_request_id = excluded.logical_request_id,
        attempt_index = excluded.attempt_index,
        session_id = excluded.session_id,
        turn_id = excluded.turn_id,
        trace_id = excluded.trace_id,
        span_id = excluded.span_id,
        assistant_message_id = excluded.assistant_message_id,
        parent_user_message_id = excluded.parent_user_message_id,
        query_source = excluded.query_source,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        variant = excluded.variant,
        agent = excluded.agent,
        mode = excluded.mode,
        task_type = excluded.task_type,
        status = excluded.status,
        started_at = excluded.started_at,
        first_token_at = excluded.first_token_at,
        completed_at = excluded.completed_at,
        duration_ms = excluded.duration_ms,
        time_to_first_token_ms = excluded.time_to_first_token_ms,
        finish_reason = excluded.finish_reason,
        tool_call_count = excluded.tool_call_count,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        cache_creation_input_tokens = excluded.cache_creation_input_tokens,
        cache_read_input_tokens = excluded.cache_read_input_tokens,
        provider_total_tokens = excluded.provider_total_tokens,
        computed_total_tokens = excluded.computed_total_tokens,
        retry_count = excluded.retry_count,
        retryable = excluded.retryable,
        cancelled_by_user = excluded.cancelled_by_user,
        context_exceeded = excluded.context_exceeded,
        error_type = excluded.error_type,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        raw_usage_json = excluded.raw_usage_json,
        provider_metadata_json = excluded.provider_metadata_json
      `,
  ).run(
    input.id,
    input.logicalRequestId,
    integer(input.attemptIndex),
    input.sessionID,
    input.turnID ?? null,
    input.traceID ?? null,
    input.spanID ?? null,
    input.assistantMessageID ?? null,
    input.parentUserMessageID ?? null,
    input.querySource,
    input.providerId,
    input.modelId,
    input.reasoningLevel ?? null,
    input.agent ?? null,
    input.mode ?? null,
    input.taskType ?? null,
    input.status,
    input.startedAt,
    input.firstTokenAt ?? null,
    input.completedAt ?? null,
    input.durationMs ?? null,
    input.timeToFirstTokenMs ?? null,
    input.finishReason ?? null,
    integer(input.toolCallCount),
    integer(input.inputTokens),
    integer(input.outputTokens),
    integer(input.reasoningTokens),
    integer(input.cacheCreationInputTokens),
    integer(input.cacheReadInputTokens),
    input.providerTotalTokens ?? null,
    computedTotalTokens,
    integer(input.retryCount),
    boolean(input.retryable),
    boolean(input.cancelledByUser),
    boolean(input.contextExceeded),
    input.errorType ?? null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    encodeJson(input.rawUsage),
    encodeJson(input.providerMetadata),
  );
  await pruneUsage(db);
}

export async function pruneUsage(
  db: DatabaseSync,
  input: { beforeTime?: number } = {},
): Promise<void> {
  const beforeTime = input.beforeTime ?? Date.now() - USAGE_RETENTION_MS;
  db.exec("begin immediate");
  try {
    db.prepare("delete from model_usage where started_at < ?").run(beforeTime);
    db.prepare("delete from turn_usage where started_at < ?").run(beforeTime);
    db.prepare("delete from tool_usage where started_at < ?").run(beforeTime);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export function inputSideTokensFromNormalizedUsage(
  inputTokens: number | null | undefined,
  cacheCreationTokens: number | null | undefined,
  cacheReadTokens: number | null | undefined,
): number {
  const input = integer(inputTokens);
  if (input > 0) {
    return input;
  }
  return integer(cacheCreationTokens) + integer(cacheReadTokens);
}

export function integer(value: number | null | undefined): number {
  // providerTotalTokens 这类旧记录字段可能是 null；adapters 独立 tsc 需要先完成类型收窄。
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function boolean(value: boolean | undefined): number {
  return value ? 1 : 0;
}
