import type { SqliteMigration } from "./migration-types.js";
export const migration0008: SqliteMigration = {
  appVersion: "0.13.0",
  id: "0008_workflow_definition_scope",
  sql: `
      alter table workflow_definition
        add column scope text not null default 'explicit'
        check(scope in ('builtin', 'explicit', 'project', 'user'));
    `,
};
