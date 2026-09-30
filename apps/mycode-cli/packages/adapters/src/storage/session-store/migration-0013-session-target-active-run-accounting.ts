import type { SqliteMigration } from "./migration-types.js";
export const migration0013: SqliteMigration = {
  appVersion: "0.15.0",
  id: "0013_session_target_active_run_accounting",
  sql: `
      alter table session_target add column active_input_id text;
      alter table session_target add column active_run_started_at integer;
      alter table session_target add column active_run_last_seen_at integer;
    `,
};
