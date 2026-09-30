// ============================================================
// SQLite session target helpers
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import type { SessionId, SessionGoal, GoalStatus } from "@mycode/contracts";
import {
  readSessionTarget,
  touchSessionForTarget,
  mustReadTarget,
} from "./session-target-read-session-target.js";
import { elapsedSecondsBetween } from "./session-target-heartbeat-session-target-run.js";

export function finishSessionTargetRun(
  db: DatabaseSync,
  input: {
    sessionID: SessionId;
    targetID: string;
    inputID: string;
    endedAtMs: number;
    status?: GoalStatus;
    tokensUsedDelta?: number;
  },
): SessionGoal | null {
  const current = readSessionTarget(db, { sessionID: input.sessionID });
  if (
    !current ||
    current.targetID !== input.targetID ||
    current.activeInputId !== input.inputID ||
    current.activeRunStartedAtMs == null
  ) {
    return current;
  }

  const endedAt = Math.max(0, input.endedAtMs);
  const tokenDelta = Math.max(0, input.tokensUsedDelta ?? 0);
  const timeDelta = elapsedSecondsBetween(current.activeRunStartedAtMs, endedAt);
  const result = db
    .prepare(
      `
      update session_target
      set
        tokens_used = tokens_used + ?,
        time_used_seconds = time_used_seconds + ?,
        status = case
          when ? is not null then ?
          when status = 'active' and token_budget is not null and tokens_used + ? >= token_budget then 'budget_limited'
          else status
        end,
        active_input_id = null,
        active_run_started_at = null,
        active_run_last_seen_at = null,
        time_updated = max(time_updated, ?)
      where session_id = ?
        and target_id = ?
        and active_input_id = ?
        and active_run_started_at = ?
      `,
    )
    .run(
      tokenDelta,
      timeDelta,
      input.status ?? null,
      input.status ?? null,
      tokenDelta,
      endedAt,
      input.sessionID,
      input.targetID,
      input.inputID,
      current.activeRunStartedAtMs,
    );
  if (result.changes === 0) return readSessionTarget(db, { sessionID: input.sessionID });
  touchSessionForTarget(db, input.sessionID, endedAt);
  return mustReadTarget(db, input.sessionID);
}

export { readSessionTarget } from "./session-target-read-session-target.js";
export { setSessionTarget } from "./session-target-read-session-target.js";
export { cloneSessionTargetForFork } from "./session-target-read-session-target.js";
export { createSessionTarget } from "./session-target-read-session-target.js";
export { updateSessionTargetStatus } from "./session-target-read-session-target.js";
export { startSessionTargetRun } from "./session-target-read-session-target.js";
export { heartbeatSessionTargetRun } from "./session-target-heartbeat-session-target-run.js";
export { recoverInterruptedSessionTargetRun } from "./session-target-heartbeat-session-target-run.js";
export { accountSessionTargetUsage } from "./session-target-heartbeat-session-target-run.js";
export { updateSessionTargetSummaryTitle } from "./session-target-heartbeat-session-target-run.js";
export { clearSessionTarget } from "./session-target-heartbeat-session-target-run.js";
