import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  runTasksDatabaseMigrations,
  areTasksDatabaseMigrationsApplied,
} from "../src/session/tasksDatabase/migrations.js";
import { runSqliteSessionMigrations } from "../../../apps/mycode-cli/packages/adapters/src/storage/session-store/migration-runner.js";

const oldSessionChecksums = {
  "0020_provider_model_selection":
    "681180b4fcb497e13289b6970021678f24c975efdf3538777541105c5b2b444e",
  "0021_official_glm_selection": "433a8da454682406e962b043f2e0f412e9801bf7e4641ff25760aa16625ebafe",
  "0022_backfilled_session_reasoning":
    "aee472fe499e9c25d2e71df0fbc68d92e462b30d1d02919ca35d540bf133c99a",
};

test("session databases accept exact released retired checksums and still reject corruption", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runSqliteSessionMigrations(db, ":memory:");
    for (const [id, hash] of Object.entries(oldSessionChecksums)) {
      db.prepare("UPDATE schema_migration SET checksum=? WHERE id=?").run(hash, id);
    }
    runSqliteSessionMigrations(db, ":memory:");
    db.prepare("UPDATE schema_migration SET checksum='corrupt' WHERE id=?").run(
      "0021_official_glm_selection",
    );
    assert.throws(() => runSqliteSessionMigrations(db, ":memory:"), /checksum mismatch/);
  } finally {
    db.close();
  }
});

test("task database startup accepts the exact retired checksum without rewriting its ledger", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runTasksDatabaseMigrations(db);
    const previous = "8987adb50ae412a46c294141c1af89ccfc252f22d41351bdf4c7528f56edc8b4";
    db.prepare(
      "UPDATE tasks_schema_migration SET checksum=? WHERE id='0003_official_glm_selection'",
    ).run(previous);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
    runTasksDatabaseMigrations(db);
    assert.equal(
      db
        .prepare(
          "SELECT checksum FROM tasks_schema_migration WHERE id='0003_official_glm_selection'",
        )
        .get()?.checksum,
      previous,
    );
    db.prepare(
      "UPDATE tasks_schema_migration SET checksum='corrupt' WHERE id='0003_official_glm_selection'",
    ).run();
    assert.throws(() => runTasksDatabaseMigrations(db), /checksum mismatch/);
  } finally {
    db.close();
  }
});
