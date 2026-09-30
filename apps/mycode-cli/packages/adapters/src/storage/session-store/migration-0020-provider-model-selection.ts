import { PROVIDER_MODEL_SELECTION_MIGRATION_SQL } from "./migrations/0020-provider-model-selection.js";

import type { SqliteMigration } from "./migration-types.js";
export const migration0020: SqliteMigration = {
  appVersion: "0.16.5",
  id: "0020_provider_model_selection",
  sql: PROVIDER_MODEL_SELECTION_MIGRATION_SQL,
};
