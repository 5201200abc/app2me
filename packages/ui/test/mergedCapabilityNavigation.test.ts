import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  addPendingSettingsSectionListener,
  consumeInitialSettingsSection,
  consumePendingSettingsPluginOrigin,
  consumePendingSettingsPluginScopeKey,
  consumePendingSettingsPluginTab,
  setPendingSettingsPluginIntent,
  setPendingSettingsSectionIntent,
} from "../src/lib/settingsNavigation.js";
import { createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() }),
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

test("Desktop and Web expose one plugin capability entry", () => {
  for (const platform of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const ids = createSettingsPageConfig(platform).settingsSections.map(({ id }) => id);
    assert.ok(ids.includes("plugin") && ids.includes("commands"));
    assert.ok(!ids.includes("mcp") && !ids.includes("skill"));
  }
});

test("Legacy section intents select the correct plugin tab at cold start", () => {
  for (const [section, tab] of [
    ["mcp", "mcps"],
    ["skill", "skills"],
    ["subagents", "subagents"],
  ] as const) {
    setPendingSettingsSectionIntent(section, {
      pluginScopeKey: "remote-project",
      pluginOrigin: "plugin-store",
    });
    assert.equal(consumeInitialSettingsSection(), "plugin");
    assert.equal(consumePendingSettingsPluginTab(), tab);
    assert.equal(consumePendingSettingsPluginScopeKey(), "remote-project");
    assert.equal(consumePendingSettingsPluginOrigin(), "plugin-store");
  }
});

test("Existing settings receives canonical section, tab, scope and origin together", () => {
  const seen: unknown[] = [];
  const unsubscribe = addPendingSettingsSectionListener((section, detail) =>
    seen.push({ section, detail }),
  );
  setPendingSettingsPluginIntent("mcps", { scopeKey: "connected-project", origin: "plugin-store" });
  unsubscribe();
  const result = seen[0] as {
    section: string;
    detail: { pluginTab: string; pluginScopeKey: string; pluginOrigin: string };
  };
  assert.equal(result.section, "plugin");
  assert.equal(result.detail.pluginTab, "mcps");
  assert.equal(result.detail.pluginScopeKey, "connected-project");
  assert.equal(result.detail.pluginOrigin, "plugin-store");
  assert.equal(window.sessionStorage.getItem("mycode-settings-section-intent"), null);
});

test("Legacy saved preferences migrate to plugin and the matching tab", () => {
  for (const [id, tab] of [
    ["mcp", "mcps"],
    ["skill", "skills"],
    ["skills", "skills"],
    ["subagents", "subagents"],
  ]) {
    window.localStorage.setItem("mycode-settings-last-section", id);
    assert.equal(consumeInitialSettingsSection(), "plugin");
    assert.equal(consumePendingSettingsPluginTab(), tab);
    assert.equal(window.localStorage.getItem("mycode-settings-last-section"), "plugin");
  }
});

test("An explicit plugin tab wins over a legacy saved preference", () => {
  window.localStorage.setItem("mycode-settings-last-section", "mcp");
  setPendingSettingsPluginIntent("skills");
  assert.equal(consumeInitialSettingsSection(), "plugin");
  assert.equal(consumePendingSettingsPluginTab(), "skills");
});

test("Commands keep their independent navigation", () => {
  setPendingSettingsPluginIntent("commands");
  assert.equal(consumeInitialSettingsSection(), "commands");
  assert.equal(consumePendingSettingsPluginTab(), undefined);
});

test("设置分组与平台入口符合新的 Basic / Integrations / Coding / Tools 归属", () => {
  for (const platform of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSectionGroups, settingsSections } = createSettingsPageConfig(platform);
    assert.deepEqual(
      settingsSectionGroups.map(({ id }) => id),
      ["basics", "integrations", "coding", "tools", "dataAndStats"],
    );
    const groups = new Map(
      settingsSectionGroups.map((group) => [group.id, group.sections.map(({ id }) => id)]),
    );
    assert.deepEqual(groups.get("basics"), ["general", "appearance", "modelProvider", "shortcuts"]);
    assert.deepEqual(groups.get("coding"), ["hooks"]);
    assert.deepEqual(groups.get("tools"), ["commands"]);
    assert.deepEqual(
      groups.get("integrations"),
      platform.isDesktop || platform.isMacDesktop || platform.isWindowsDesktop
        ? ["plugin", "computerUse", "browser"]
        : ["plugin", "browser"],
    );
    assert.ok(!settingsSections.some(({ id }) => id === "memory" || id === "subagents"));
  }
});

test("旧记忆入口与保存偏好均迁移到常规", () => {
  window.localStorage.setItem("mycode-settings-last-section", "memory");
  assert.equal(consumeInitialSettingsSection(), "general");
  assert.equal(window.localStorage.getItem("mycode-settings-last-section"), "general");
  setPendingSettingsSectionIntent("memory");
  assert.equal(consumeInitialSettingsSection(), "general");
  window.sessionStorage.setItem("mycode-settings-section-intent", "memory");
  assert.equal(consumeInitialSettingsSection(), "general");
});

test("旧子智能体 session 意图与同窗事件保留正确标签", () => {
  window.sessionStorage.setItem("mycode-settings-section-intent", "subagents");
  assert.equal(consumeInitialSettingsSection(), "plugin");
  assert.equal(consumePendingSettingsPluginTab(), "subagents");
  const seen: unknown[] = [];
  const unsubscribe = addPendingSettingsSectionListener((section, detail) =>
    seen.push({ section, detail }),
  );
  setPendingSettingsSectionIntent("subagents");
  unsubscribe();
  assert.deepEqual(seen, [
    {
      section: "plugin",
      detail: {
        section: "plugin",
        pluginTab: "subagents",
        pluginOrigin: undefined,
        pluginScopeKey: undefined,
        usageTab: undefined,
        modelProviderId: undefined,
      },
    },
  ]);
});

test("显式插件标签优先于旧子智能体偏好", () => {
  window.localStorage.setItem("mycode-settings-last-section", "subagents");
  setPendingSettingsPluginIntent("skills");
  assert.equal(consumeInitialSettingsSection(), "plugin");
  assert.equal(consumePendingSettingsPluginTab(), "skills");
});
