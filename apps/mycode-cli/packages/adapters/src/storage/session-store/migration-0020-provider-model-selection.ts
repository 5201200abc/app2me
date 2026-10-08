import { PROVIDER_MODEL_SELECTION_MIGRATION_SQL } from "./migrations/0020-provider-model-selection.js";

import type { SqliteMigration } from "./migration-types.js";
export const migration0020: SqliteMigration = {
  appVersion: "0.16.5",
  id: "0020_provider_model_selection",
  retiredChecksum: "681180b4fcb497e13289b6970021678f24c975efdf3538777541105c5b2b444e",
  sql: PROVIDER_MODEL_SELECTION_MIGRATION_SQL,
};
