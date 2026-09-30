import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { _electron } from "playwright-core";
import { prepareDevElectronAppBundle } from "../packages/desktop/scripts/devElectronAppBundle.mjs";

const root = await mkdtemp(join(tmpdir(), "mycode-desktop-smoke-"));
const output = resolve(".artifacts");
await mkdir(output, { recursive: true });
const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const bundle = await prepareDevElectronAppBundle({
  electronAppPath: resolve(dirname(require("electron")), "../.."),
  electronVersion: require("electron/package.json").version,
  runtimeRoot: resolve(".mycode-runtime/desktop-dev"),
  arch: process.arch,
});
const { executablePath } = bundle;
const icon = await readFile(join(bundle.appPath, "Contents/Resources/mycode.icns"));
const sourceIcon = await readFile(resolve("packages/desktop/build/icon.icns"));
await writeFile(
  join(output, "mycode-native-app.json"),
  JSON.stringify(
    {
      ...bundle,
      iconHeader: icon.subarray(0, 4).toString(),
      iconSha256: createHash("sha256").update(icon).digest("hex"),
      iconMatchesSource: icon.equals(sourceIcon),
    },
    null,
    2,
  ),
);
assert.ok(icon.equals(sourceIcon));
let app;
const errors = [];
const preloadErrors = [];
try {
  app = await _electron.launch({
    executablePath,
    args: [resolve("packages/desktop"), `--user-data-dir=${join(root, "electron")}`],
    env: { ...process.env, MYCODE_DATA_BASE_DIR: root, MYCODE_STORAGE_DIR: join(root, ".mycode") },
  });
  app.process().stderr.on("data", (data) => {
    const text = String(data);
    if (/preload|module not found|Cannot read properties/.test(text)) preloadErrors.push(text);
  });
  app.on("window", (window) => window.on("pageerror", (error) => errors.push(error.message)));
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" && /preload|module not found/.test(message.text()))
      preloadErrors.push(message.text());
  });
  await page.waitForLoadState();
  const bridge = await page.evaluate(() => typeof window.mycode);
  try {
    // 全新隔离数据目录会显示首次设置页；通过真实按钮进入主界面后再检查输入框。
    const startUsing = page.getByRole("button", { name: /^(开始使用|Get started|Start using)$/ });
    await page
      .locator('[data-testid="composer-model-controls"]')
      .or(startUsing)
      .waitFor({ timeout: 20_000 });
    if (await startUsing.isVisible()) await startUsing.click();
    await page.locator('[data-testid="composer-model-controls"]').waitFor({ timeout: 20_000 });
  } catch (error) {
    errors.push(error.message.split("\n")[0]);
  }
  await page.screenshot({ path: join(output, "mycode-native-window.png") });
  const result = {
    title: await page.title(),
    bridge,
    errors,
    preloadErrors,
    rendered: (await page.locator('[data-testid="composer-model-controls"]').count()) > 0,
  };
  await writeFile(join(output, "mycode-native-window.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(bridge, "object");
  assert.equal(result.rendered, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(preloadErrors, []);
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
