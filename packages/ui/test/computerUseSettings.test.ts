import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
} from "../src/settings/settingsPageConfig.js";
import { matchesComputerUseSearch } from "../src/settings/computerUseAvailability.js";
import { resolveSettingsSection } from "../src/lib/settingsNavigation.js";

test("Desktop exposes Computer Use settings and accepts direct navigation", () => {
  for (const platform of [
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSections } = createSettingsPageConfig(platform);
    assert.ok(settingsSections.some(({ id }) => id === "computerUse"));
    assert.equal(resolveSettingsSection("computerUse"), "computerUse");
    assert.equal(resolveSettingsSectionForPlatform("computerUse", settingsSections), "computerUse");
  }
});

test("Web settings cannot navigate to local desktop control", () => {
  const { settingsSections } = createSettingsPageConfig();
  assert.ok(!settingsSections.some(({ id }) => id === "computerUse"));
  assert.equal(resolveSettingsSectionForPlatform("computerUse", settingsSections), "general");
});

test("计算机使用按新名称搜索，旧名称继续兼容", () => {
  assert.equal(matchesComputerUseSearch("计算机使用"), true);
  assert.equal(matchesComputerUseSearch("电脑控制"), true);
  assert.equal(matchesComputerUseSearch("控制"), true);
  assert.equal(matchesComputerUseSearch("Control"), true);
  assert.equal(matchesComputerUseSearch("未知功能"), false);
});
