import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

test("官方种子使用指定中文说明，Node Repl Host 仍没有市场 listing", () => {
  for (const [name, expected] of [
    ["browser-use", "让 AI 操作 MyCode 内置浏览器，检查网页并验证交互是否正常。"],
    ["computer-use", "让 AI 驱动鼠标、键盘和界面元素，自动操作桌面应用，代你完成实际任务。"],
  ]) {
    const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((plugin) => plugin.name === name);
    assert.equal(definition?.listing?.description_i18n?.["zh-CN"], expected);
  }
  const host = OFFICIAL_PLUGIN_DEFINITIONS.find((plugin) => plugin.name === "node-repl-host");
  assert.ok(host);
  assert.equal(host.listing, undefined);
});
