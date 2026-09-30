import { BACKFILLED_SESSION_REASONING_MIGRATION_SQL } from "./migrations/0022-backfilled-session-reasoning.js";
import type { SqliteMigration } from "./migration-types.js";
export const migration0022: SqliteMigration = {
  appVersion: "0.16.5",
  id: "0022_backfilled_session_reasoning",
  sql: BACKFILLED_SESSION_REASONING_MIGRATION_SQL,
};
