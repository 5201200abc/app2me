import { migration0001 } from "./migration-0001-base-session-store.js";
import { migration0002 } from "./migration-0002-local-setting.js";
import { migration0003 } from "./migration-0003-backfill-permission-local-setting.js";
import { migration0004 } from "./migration-0004-session-target.js";
import { migration0005 } from "./migration-0005-session-target-accounting.js";
import { migration0006 } from "./migration-0006-input-history-attachments.js";
import { migration0007 } from "./migration-0007-workflow-script-runtime.js";
import { migration0008 } from "./migration-0008-workflow-definition-scope.js";
import { migration0009 } from "./migration-0009-session-title-metadata.js";
import { migration0010 } from "./migration-0010-usage-observability.js";
import { migration0011 } from "./migration-0011-session-target-summary-title.js";
import { migration0012 } from "./migration-0012-session-trace-id.js";
import { migration0013 } from "./migration-0013-session-target-active-run-accounting.js";
import { migration0014 } from "./migration-0014-message-part-sequence.js";
import { migration0015 } from "./migration-0015-message-part-sequence-backfill-and-guard.js";
import { migration0016 } from "./migration-0016-session-input-ledger.js";
import { migration0017 } from "./migration-0017-session-input-start-now-delivery.js";
import { migration0018 } from "./migration-0018-session-input-failed-status.js";
import { migration0019 } from "./migration-0019-dwf-journal.js";
import { migration0020 } from "./migration-0020-provider-model-selection.js";
import { migration0021 } from "./migration-0021-official-glm-selection.js";
import { migration0022 } from "./migration-0022-backfilled-session-reasoning.js";
import type { SqliteMigration } from "./migration-types.js";

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
];
