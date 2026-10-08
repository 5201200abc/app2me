import assert from "node:assert/strict";
import test from "node:test";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID, type MyCodePluginInfo } from "@mycode/shared";
import {
  buildStoreItems,
  resolveItemDescription,
  resolveManagedPluginDisplay,
  type StorePluginItem,
} from "../src/settings/pluginStoreListing.js";

function plugin(
  name: string,
  marketplace = MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
): MyCodePluginInfo {
  return {
    id: `${name}@${marketplace}`,
    name,
    marketplace,
    source: "official",
    description: "English manifest description",
    enabled: true,
    skillRootCount: 0,
    commandRootCount: 0,
    mcpServerNames: [],
    rootPath: "/fixture/plugin",
  };
}

function cachedItem(info: MyCodePluginInfo): StorePluginItem {
  return {
    id: info.id,
    name: info.name,
    marketplace: info.marketplace,
    installed: true,
    restorable: false,
    orphaned: false,
    info,
    listing: { descriptionI18n: { "zh-CN": "旧缓存说明" } },
  };
}

test("官方管理列表与商店详情都使用当前中文说明，不受旧目录缓存影响", () => {
  for (const [name, expected] of [
    ["browser-use", "让 AI 操作 MyCode 内置浏览器，检查网页并验证交互是否正常。"],
    ["computer-use", "让 AI 驱动鼠标、键盘和界面元素，自动操作桌面应用，代你完成实际任务。"],
  ]) {
    const info = plugin(name);
    const item = cachedItem(info);
    assert.equal(resolveItemDescription(item, "zh-CN"), expected);
    assert.equal(resolveManagedPluginDisplay(info, item, "zh-CN").description, expected);
    assert.equal(resolveManagedPluginDisplay(info, undefined, "zh-CN").description, expected);
    assert.equal(item.listing?.descriptionI18n?.["zh-CN"], "旧缓存说明");
  }
});

test("无 listing 的 Node Repl Host 显示中文说明且不进入市场", () => {
  const info = plugin("node-repl-host");
  assert.equal(
    resolveManagedPluginDisplay(info, undefined, "zh-CN").description,
    "MyCode 官方功能共用的 Node 运行环境（node_repl，运行 JavaScript 的交互环境）。不是给用户直接用的，不带技能，也不出现在插件市场。",
  );
  assert.deepEqual(
    buildStoreItems({
      marketplaces: [],
      marketplaceAvailabilityKnown: true,
      availablePlugins: [{ ...info, installed: true }],
      installedPlugins: [],
      plugins: [info],
      restorableBuiltins: [],
    }),
    [],
  );
});

test("第三方同名插件与非中文文案保留原来的解析路径", () => {
  for (const name of ["browser-use", "computer-use", "node-repl-host"]) {
    const personal = plugin(name, "personal-marketplace");
    assert.equal(resolveItemDescription(cachedItem(personal), "zh-CN"), "旧缓存说明");
    assert.equal(
      resolveManagedPluginDisplay(personal, undefined, "zh-CN").description,
      personal.description,
    );
    const official = plugin(name);
    assert.equal(resolveItemDescription(cachedItem(official), "en-US"), official.description);
    assert.equal(
      resolveManagedPluginDisplay(official, undefined, "en-US").description,
      official.description,
    );
  }
});
