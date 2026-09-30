import type { SqliteMigration } from "./migration-types.js";
export const migration0012: SqliteMigration = {
  appVersion: "0.15.0",
  id: "0012_session_trace_id",
  sql: `
      alter table session add column trace_id text;

      create index if not exists session_trace_idx on session(trace_id);
    `,
};
