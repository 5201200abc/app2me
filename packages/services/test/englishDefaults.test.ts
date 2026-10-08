import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LOCALE } from "@mycode/shared";
import { appSettingsSchema } from "../../shared/src/validationAppSettings.js";
import { normalizeBotMessageLocale, formatBotMessage } from "../src/bots/messages.js";
import { initDb, closeDb, writeSetting } from "../src/mychat/runtime/db.js";
import { getSettings } from "../src/mychat/runtime/store.js";
import { resolveConversationShareRouteLocale } from "../../web/src/share/conversationSharePreviewClient.js";

test("fresh settings default to English while saved preferences survive migration", () => {
  assert.equal(DEFAULT_LOCALE, "en-US");
  const fresh = appSettingsSchema.parse({});
  assert.equal(fresh.locale, "en-US");
  assert.equal(fresh.localePreference, "en-US");
  const legacy = appSettingsSchema.parse({ locale: "zh-CN" });
  assert.equal(legacy.locale, "zh-CN");
  assert.equal(legacy.localePreference, "zh-CN");
  const system = appSettingsSchema.parse({ locale: "zh-CN", localePreference: "system" });
  assert.equal(system.localePreference, "system");
});

test("Bot and share defaults are English and explicit Chinese remains available", () => {
  assert.equal(normalizeBotMessageLocale(undefined), "en-US");
  assert.equal(normalizeBotMessageLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeBotMessageLocale("en-US"), "en-US");
  assert.equal(resolveConversationShareRouteLocale("/"), "en-US");
  assert.equal(resolveConversationShareRouteLocale("/share/example"), "en-US");
  assert.equal(resolveConversationShareRouteLocale("/cn/share/example"), "zh-CN");
  assert.equal(formatBotMessage(undefined, "botDisabled"), "This bot is not enabled.");
  assert.equal(formatBotMessage("zh-CN", "botDisabled"), "当前 bot 未启用。");
});

test("MyChat fresh storage defaults to English and preserves saved Chinese", async () => {
  const directory = await mkdtemp(join(tmpdir(), "app2me-english-defaults-"));
  try {
    await initDb(directory);
    assert.equal(getSettings().language, "en");
    writeSetting("language", "zh");
    assert.equal(getSettings().language, "zh");
  } finally {
    closeDb();
    await rm(directory, { recursive: true, force: true });
  }
});
