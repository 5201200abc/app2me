import assert from "node:assert/strict";
import test from "node:test";
import { onboardingRecordFileSchema, SHORTCUT_COMMANDS } from "@mycode/shared";

test("历史引导模式和专属推荐字段被剥离，独立偏好保留", () => {
  const entry = {
    userId: null,
    occupation: "other",
    interfaceMode: "office",
    proactiveSuggestionsEnabled: true,
    memoryEnabled: true,
    completedAt: "2026-01-01",
    uploadState: "pending",
  };
  const record = onboardingRecordFileSchema.parse({
    version: 1,
    deviceMid: "test-device",
    entries: [entry],
  });
  assert.equal(record.version, 2);
  assert.equal(record.entries[0]?.memoryEnabled, true);
  assert.equal("interfaceMode" in record.entries[0]!, false);
  assert.equal("proactiveSuggestionsEnabled" in record.entries[0]!, false);
  assert.deepEqual(record.decisions, []);
});

test("界面模式快捷键不再注册", () => {
  assert.equal(
    SHORTCUT_COMMANDS.some((command) => String(command.id) === "toggleInterfaceMode"),
    false,
  );
});
