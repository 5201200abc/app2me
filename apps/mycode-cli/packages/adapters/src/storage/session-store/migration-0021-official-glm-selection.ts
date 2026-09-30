import { OFFICIAL_GLM_SELECTION_MIGRATION_SQL } from "./migrations/0021-official-glm-selection.js";

import type { SqliteMigration } from "./migration-types.js";
export const migration0021: SqliteMigration = {
  appVersion: "0.16.5",
  id: "0021_official_glm_selection",
  sql: OFFICIAL_GLM_SELECTION_MIGRATION_SQL,
};
