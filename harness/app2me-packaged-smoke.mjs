import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { _electron } from "playwright-core";

const appPath = resolve(process.argv[2] ?? "releases/current/mac-arm64/app2me.app");
const output = resolve(".artifacts/app2me-migration");
const profile = await mkdtemp(join(tmpdir(), "app2me-packaged-e2e-"));
await mkdir(output, { recursive: true });
await mkdir(join(profile, "electron", "session"), { recursive: true });
const errors = [];
const stderr = [];
let app;
try {
  app = await _electron.launch({
    executablePath: join(appPath, "Contents", "MacOS", "app2me"),
    args: [],
    timeout: 45000,
    env: {
      ...process.env,
      MYCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      MYCODE_DESKTOP_HOME_DIR: profile,
      MYCODE_DESKTOP_USER_DATA_DIR: join(profile, "electron"),
      MYCODE_DESKTOP_SESSION_DATA_DIR: join(profile, "electron", "session"),
      MYCODE_DATA_BASE_DIR: profile,
      MYCODE_STORAGE_DIR: join(profile, ".mycode"),
    },
  });
  app.process().stderr.on("data", (data) => stderr.push(String(data)));
  app.on("window", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const identity = await app.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
  }));
  assert.equal(identity.name, "app2me");
  assert.equal(identity.packaged, true);
  assert.match(identity.version, /^\d{4}\.\d+\.\d+$/);
  assert.equal(identity.userData, join(profile, "electron"));
  const page = await app.firstWindow({ timeout: 45000 });
  page.on("pageerror", (error) => errors.push(error.message));
  const win = await app.browserWindow(page);
  await win.evaluate((window) => window.setBounds({ width: 1280, height: 900 }));
  const code = page.locator('[data-root-workspace-surface="interactive"]');
  await code.getByRole("button", { name: "MyCode", exact: true }).waitFor({ timeout: 45000 });
  await page.screenshot({ path: join(output, "packaged-mycode.png") });
  await code.getByRole("button", { name: "MyCode", exact: true }).click();
  await page.getByRole("menuitem", { name: /^(布局模式|Layout mode)$/ }).hover();
  await page.getByRole("menuitemradio", { name: "MyChat", exact: true }).click();
  await page.locator(".mychat-surface").waitFor();
  await page
    .getByRole("menuitem", { name: /^(布局模式|Layout mode)$/ })
    .waitFor({ state: "hidden" });
  await page.screenshot({ path: join(output, "packaged-mychat.png") });
  await page
    .locator(".mychat-surface")
    .getByRole("button", { name: "MyChat", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^(布局模式|Layout mode)$/ }).hover();
  await page.getByRole("menuitemradio", { name: "MyCode", exact: true }).click();
  await code.waitFor();
  assert.deepEqual(errors, []);
  assert.doesNotMatch(stderr.join(""), /Cannot find module|STARTUP_EXCEPTION|ENTRY_IMPORT_ERROR/);
  await writeFile(
    join(output, "packaged-smoke.json"),
    JSON.stringify({ identity, modes: ["MyCode", "MyChat", "MyCode"], errors }, null, 2),
  );
  console.log(
    "PASS packaged app2me: native identity, isolated data and MyCode/MyChat mode switching",
  );
} finally {
  await writeFile(join(output, "packaged-smoke-stderr.log"), stderr.join(""));
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
