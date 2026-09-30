import type { SqliteMigration } from "./migration-types.js";
export const migration0009: SqliteMigration = {
  appVersion: "0.14.0",
  id: "0009_session_title_metadata",
  sql: `
      alter table session
        add column title_source text not null default 'first_input'
        check(title_source in ('default', 'first_input', 'generated', 'custom'));

      alter table session
        add column title_message_id text;

      alter table session
        add column time_title_updated integer;
    `,
};
