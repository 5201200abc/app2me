import assert from "node:assert/strict";
import test from "node:test";
import { MYCODE_BRAND_PATHS } from "@mycode/shared";
import { createCustomAboutDialogHtml } from "./aboutWindow.js";

test("关于窗口共用主页线稿，移除平台文案并转义信息", () => {
  const html = createCustomAboutDialogHtml({
    applicationName: "MyCode <App>",
    appVersion: "1&2",
    copyright: "版权所有",
    versionLabel: "版本",
    okButtonLabel: "确定",
  });
  for (const path of MYCODE_BRAND_PATHS) assert.ok(html.includes(path));
  assert.doesNotMatch(html, /Apple Silicon|optimizationLine|0 0 256 218|linear-gradient/);
  assert.ok(html.includes("MyCode &lt;App&gt;"));
  assert.ok(html.includes("1&amp;2"));
  assert.ok(html.includes('event.key === "Escape" || event.key === "Enter"'));
});
