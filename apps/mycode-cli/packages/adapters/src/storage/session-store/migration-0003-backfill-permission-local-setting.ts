import type { SqliteMigration } from "./migration-types.js";
export const migration0003: SqliteMigration = {
  appVersion: "0.2.0",
  id: "0003_backfill_permission_local_setting",
  sql: `
      insert or ignore into local_setting (
        scope,
        scope_id,
        namespace,
        key,
        value,
        schema_version,
        time_created,
        time_updated
      )
      select
        'project',
        project_id,
        'permission',
        'ruleset',
        data,
        1,
        time_created,
        time_updated
      from permission
      where data is not null;
    `,
};
