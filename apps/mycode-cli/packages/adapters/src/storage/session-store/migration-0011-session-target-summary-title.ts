import type { SqliteMigration } from "./migration-types.js";
export const migration0011: SqliteMigration = {
  appVersion: "0.15.0",
  id: "0011_session_target_summary_title",
  sql: `
      alter table session_target add column summary_title text;
    `,
};
