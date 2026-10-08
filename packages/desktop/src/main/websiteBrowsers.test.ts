import assert from "node:assert/strict";
import { test } from "node:test";
import { websiteBrowserCandidates, openWebsiteBrowser } from "./websiteBrowsers.js";

test("macOS 只列 Chrome / Safari，Windows 和 Linux 只列 Chrome", () => {
  assert.deepEqual(
    websiteBrowserCandidates("darwin", {}).map((item) => item.id),
    ["chrome", "safari"],
  );
  for (const os of ["win32", "linux"])
    assert.deepEqual(
      websiteBrowserCandidates(os, {}).map((item) => item.id),
      ["chrome"],
    );
});
test("未知应用与非页面协议不能执行外部进程", async () => {
  assert.equal((await openWebsiteBrowser("vscode", "https://example.com")).success, false);
  assert.equal((await openWebsiteBrowser("chrome", "javascript:alert(1)")).success, false);
});
