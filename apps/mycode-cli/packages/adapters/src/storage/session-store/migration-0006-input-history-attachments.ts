import type { SqliteMigration } from "./migration-types.js";
export const migration0006: SqliteMigration = {
  appVersion: "0.11.0",
  id: "0006_input_history_attachments",
  sql: `
      alter table input_history add column attachments text;
    `,
};
