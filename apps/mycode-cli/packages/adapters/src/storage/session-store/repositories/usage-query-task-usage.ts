import type { DatabaseSync } from "node:sqlite";
import type { TaskUsageQueryInput, TaskUsageQueryResult } from "@mycode/contracts";
import { inputSideTokensFromStoredUsage } from "./usage-upsert-turn-usage.js";

export async function queryTaskUsage(
  db: DatabaseSync,
  input: TaskUsageQueryInput,
): Promise<TaskUsageQueryResult> {
  const rows = db
    .prepare(
      `select
         id,
         query_source as querySource,
         status,
         input_tokens as inputTokens,
         output_tokens as outputTokens,
         reasoning_tokens as reasoningTokens,
         cache_creation_input_tokens as cacheCreationTokens,
         cache_read_input_tokens as cacheReadTokens,
         computed_total_tokens as computedTotalTokens,
         provider_total_tokens as providerTotalTokens
       from model_usage
       where session_id = ?
       order by started_at asc, id asc`,
    )
    .all(input.sessionID) as Array<{
    cacheCreationTokens: number;
    cacheReadTokens: number;
    computedTotalTokens: number;
    inputTokens: number;
    outputTokens: number;
    providerTotalTokens: number | null;
    querySource: string;
    reasoningTokens: number;
    status: string;
  }>;

  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let modelErrorCount = 0;
  const inputBaselineBySource: Record<string, number> = {};

  for (const row of rows) {
    const rawTotalTokens = Number(row.providerTotalTokens ?? row.computedTotalTokens ?? 0);
    const inputSideTokens = inputSideTokensFromStoredUsage(row);
    const source = taskUsageInputBaselineSource(row.querySource);
    const incrementalInputTokens =
      source === undefined
        ? inputSideTokens
        : Math.max(0, inputSideTokens - (inputBaselineBySource[source] ?? 0));
    if (source !== undefined) {
      // 压缩会让后续 context input 变小；累计消耗不能因此回扣历史，
      // 但 baseline 必须降到压缩后的值，后续新增轮次才能继续按增量计算。
      inputBaselineBySource[source] = inputSideTokens;
    }

    const nonInputTokens = Math.max(0, rawTotalTokens - inputSideTokens);
    const rowOutputTokens = Number(row.outputTokens ?? 0);
    const rowReasoningTokens = Number(row.reasoningTokens ?? 0);
    totalTokens += incrementalInputTokens + nonInputTokens;
    inputTokens += incrementalInputTokens;
    outputTokens += rowOutputTokens;
    reasoningTokens += rowReasoningTokens;
    if (source === undefined) {
      cacheCreationTokens += Number(row.cacheCreationTokens ?? 0);
      cacheReadTokens += Number(row.cacheReadTokens ?? 0);
    }
    if (row.status === "error") {
      modelErrorCount += 1;
    }
  }

  return {
    sessionID: input.sessionID,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheCreationTokens,
    cacheReadTokens,
    modelRequestCount: rows.length,
    modelErrorCount,
    inputBaselineBySource,
  };
}

export function taskUsageInputBaselineSource(querySource: string): string | undefined {
  if (
    querySource === "main_turn" ||
    querySource === "subagent" ||
    querySource === "workflow_child"
  ) {
    return querySource;
  }
  return undefined;
}
