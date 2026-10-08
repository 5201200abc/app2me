import { selectDesktopRenderer, prepareDesktopUi } from "./mycode-compact-ui-start.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
import { createServer } from "vite";
import { verifyCompactProjectControls } from "./mycode-project-controls.mjs";
import { verifyAppearanceDetails } from "./mycode-appearance-polish.mjs";
import { verifyConversationPresentation } from "./mycode-conversation-presentation.mjs";
import {
  verifyGeneralDescriptions,
  verifyHomePresentation,
  verifyTaskHeaderRefinement,
} from "./mycode-task-header-settings.mjs";
import { verifyComposerLayout } from "./mycode-composer-layout.mjs";
import { verifySettingsRefinement } from "./mycode-settings-refinement.mjs";
import { verifyCapabilitySettings } from "./mycode-capability-settings.mjs";
import { verifyTargetedCompactUi } from "./mycode-targeted-compact-ui.mjs";
import { verifyComposerPolish } from "./mycode-composer-polish.mjs";
import { verifyModelReadOwner } from "./mycode-model-read.e2e.mjs";
import { verifySidebarRefinement, verifyTaskRowRefinement } from "./mycode-sidebar-refinement.mjs";
import {
  verifyComposerChrome,
  verifyContextPlacement,
  verifySettingsCopy,
  verifyThoughtStability,
} from "./mycode-composer-details.mjs";
import {
  verifyGoalToolbar,
  verifyModelMenu,
  verifyProviderHeadings,
  verifyHelpMenu,
  verifyAppearance,
} from "./mycode-compact-entrypoints.mjs";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "mycode-compact-ui-"));
const output = resolve(".artifacts/compact-ui");
await mkdir(output, { recursive: true });
await Promise.all(
  ["result.json", "error.txt", "failure.png"].map((name) =>
    rm(join(output, name), { force: true }),
  ),
);
let app;
let page;
const errors = [];
const desktopOutput = [];
const server = await createServer({
  root: resolve("packages/desktop/src/renderer"),
  configFile: resolve("packages/desktop/vite.config.ts"),
  // worker 在首次使用时才被发现会触发 Vite 整页重载，打断正在验证的弹框交互。
  optimizeDeps: { include: ["@pierre/diffs/worker/worker.js"] },
  server: { port: 5186, strictPort: true },
});
try {
  await server.listen();
  const launchOptions = {
    executablePath: require("electron"),
    args: [resolve("packages/desktop")],
    env: {
      ...process.env,
      MYCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      MYCODE_DESKTOP_APPLICATION_NAME: `MyCode Compact UI E2E ${process.pid}`,
      MYCODE_DESKTOP_HOME_DIR: root,
      MYCODE_DESKTOP_USER_DATA_DIR: join(root, "electron"),
      MYCODE_DESKTOP_SESSION_DATA_DIR: join(root, "electron-session"),
      MYCODE_DATA_BASE_DIR: root,
      MYCODE_STORAGE_DIR: join(root, ".mycode"),
      ELECTRON_RENDERER_URL: "http://localhost:5186",
    },
  };
  app = await _electron.launch(launchOptions);
  app.process().stderr?.on("data", (chunk) => desktopOutput.push(String(chunk)));
  app.process().stdout?.on("data", (chunk) => desktopOutput.push(String(chunk)));
  page = await selectDesktopRenderer(app);

  const nativeWindow = await app.browserWindow(page);
  const initialBounds = await nativeWindow.evaluate((win) => ({
    bounds: win.getNormalBounds(),
    minimum: win.getMinimumSize(),
  }));
  assert.deepEqual(initialBounds.minimum, [760, 520]);
  assert.equal(initialBounds.bounds.width, 1080);
  assert.equal(initialBounds.bounds.height, 720);
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => errors.push(error.message));
  await prepareDesktopUi(page);
  const scope = [
    "sources-sidebar",
    "artifact-sources",
    "operation-groups",
    "settings-groups",
    "plugin-mcp-copy",
    "summary-zoom-polish",
    "inventory-tools",
    "reference-conversation",
    "conversation-edge-alignment",
    "conversation-detail-settings",
  ].find((scope) => process.argv.includes(`--${scope}`));
  if (scope) {
    await verifyTargetedCompactUi(page, app, output, scope);
    assert.deepEqual(errors, []);
    const result = { passed: true, scope, errors };
    await Promise.all(
      ["result.json", `${result.scope}-result.json`].map((name) =>
        writeFile(join(output, name), JSON.stringify(result, null, 2)),
      ),
    );
    console.log("PASS: targeted settings verification.");
  } else {
    await page.evaluate(() => localStorage.setItem("mycode-interface-mode", "office"));
    await page.reload();
    await page.locator('[data-testid="composer-model-controls"]').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("mycode-interface-mode")), null);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const homeGeometry = await verifyHomePresentation(page, output);
    console.log("Renderer:", page.url());
    const brandStyles = await page
      .locator("[data-model-logo]")
      .first()
      .evaluate((el) => ({
        tag: el.tagName,
        style: el.getAttribute("style"),
        mask: getComputedStyle(el).maskImage,
        background: getComputedStyle(el).backgroundColor,
        border: getComputedStyle(el).borderWidth,
      }));
    await writeFile(join(output, "logo-styles.json"), JSON.stringify(brandStyles, null, 2));
    assert.notEqual(brandStyles.mask, "none");
    assert.equal(brandStyles.border, "0px");
    await page.screenshot({ path: join(output, "home.png") });
    await verifyCompactProjectControls(page, output);
    await verifySidebarRefinement(page, output);
    await verifyTaskRowRefinement(page, output);
    await verifyTaskHeaderRefinement(page, output);
    await verifyConversationPresentation(page, output);
    await verifyComposerPolish(page, output);
    await verifyComposerChrome(page);
    assert.equal(await page.getByTestId("v4-composer-cua-entry").count(), 0);
    assert.equal(
      (await page.getByTestId("v4-draft-brand").evaluate((el) => el.tagName)).toLowerCase(),
      "svg",
    );
    await page.getByRole("button", { name: /^(添加上下文|Add context)$/ }).click();
    await page.getByTestId("composer-add-plan").waitFor();
    await page.getByTestId("add-goal").waitFor();
    const rows = await page.locator('[data-trigger="+"] [role="option"]').allTextContents();
    const addText = await page.locator('[data-trigger="+"]').innerText();
    assert.doesNotMatch(addText, /^(文件|会话|对话|Files|Conversations)$/m);
    assert.doesNotMatch(
      addText,
      /选择能力|选择技能|输入内容以搜索|Select capabilities|Select skills/,
    );
    assert.ok(
      rows.findIndex((text) => /计划|Plan/.test(text)) <
        rows.findIndex((text) => /Goal|目标/.test(text)),
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".composer-action-menu")
        ?.getAnimations()
        .every((animation) => animation.playState !== "running"),
    );
    const addGeometry = await page.locator(".composer-action-menu").evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      rows: [...el.querySelectorAll('[role="option"]')].map((row) => ({
        height: row.getBoundingClientRect().height,
        virtualHeight: row.parentElement.parentElement.getBoundingClientRect().height,
      })),
    }));
    assert.equal(addGeometry.width, 272);
    assert.ok(addGeometry.rows.every((row) => row.height === 28 && row.virtualHeight === 28));
    await page.screenshot({ path: join(output, "add-menu.png") });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByTestId("v4-composer-plan-marker").waitFor();
    const permissionBounds = await page.getByTestId("chat-mode-select-trigger").boundingBox();
    const planBounds = await page.getByTestId("v4-composer-plan-marker").boundingBox();
    assert.ok(planBounds.x >= permissionBounds.x + permissionBounds.width);
    await page.getByTestId("chat-mode-select-trigger").click();
    assert.equal(await page.getByTestId("chat-mode-select-item-plan").count(), 0);
    assert.equal(await page.getByRole("menuitemradio").count(), 3);
    await page.screenshot({ path: join(output, "permission-menu.png") });
    await page.getByRole("menuitemradio", { name: /完全访问|Full access/ }).click();
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="chat-mode-select-trigger"]');
      const probe = document.createElement("span");
      probe.style.color = "var(--color-foreground-subtle)";
      el.append(probe);
      const matches = getComputedStyle(el).color === getComputedStyle(probe).color;
      probe.remove();
      return matches;
    });
    const neutralMode = await page.getByTestId("chat-mode-select-trigger").evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      el.append(probe);
      const resolveColor = (token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const warning = resolveColor("--color-warning");
      const subtle = resolveColor("--color-foreground-subtle");
      probe.remove();
      return {
        color: style.color,
        warning,
        subtle,
      };
    });
    assert.equal(neutralMode.color, neutralMode.subtle);
    assert.notEqual(neutralMode.color, neutralMode.warning);
    await page.getByRole("button", { name: /关闭计划模式|Turn off Plan mode/ }).click();
    await page.getByRole("button", { name: /^(添加上下文|Add context)$/ }).click();
    await page.getByTestId("add-goal").click();
    await verifyGoalToolbar(page, output);
    await page.getByTestId("v4-composer-input").fill("");
    await verifyThoughtStability(page, output);
    await verifyContextPlacement(page, output);
    await verifyModelReadOwner(page);
    // 窄屏场景会按产品规则收起侧栏；后续桌面入口场景恢复显式展开状态。
    await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
        240,
    );
    assert.equal(
      await page.getByTestId("chat-model-select-trigger").locator("[data-model-logo]").count(),
      1,
    );
    await page.getByTestId("chat-model-select-trigger").click();
    const modelGeometry = await verifyModelMenu(page, output);
    await verifyHelpMenu(app, page, output);
    await page.getByRole("button", { name: "MyCode", exact: true }).click();
    const preferences = page.locator(
      '.workspace-preferences-menu[data-slot="dropdown-menu-content"]',
    );
    await preferences.waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('.workspace-preferences-menu[data-slot="dropdown-menu-content"]')
        ?.getAnimations()
        .every((animation) => animation.playState !== "running"),
    );
    assert.equal((await preferences.boundingBox()).width, 176);
    assert.equal(await preferences.getByText(/界面模式|Interface mode/).count(), 0);
    const preferencesGeometry = await preferences
      .locator('[role="menuitem"]')
      .evaluateAll((items) =>
        items.map((el) => ({
          font: getComputedStyle(el).fontSize,
          height: el.getBoundingClientRect().height,
        })),
      );
    assert.ok(preferencesGeometry.every((row) => row.font === "12px" && row.height <= 29));
    await page.screenshot({ path: join(output, "preferences-menu.png") });
    await page.getByRole("menuitem", { name: /界面主题|Theme/ }).press("ArrowRight");
    await page.getByRole("menuitemradio", { name: /浅色|Light/ }).press("Enter");
    await page.waitForFunction(() => {
      const shell = document.querySelector("[data-prompt-editor-shell]");
      return (
        document.documentElement.classList.contains("theme-mycode-light") &&
        !document.querySelector('[role="menu"]') &&
        getComputedStyle(shell).backgroundColor === "rgb(255, 255, 255)"
      );
    });
    await page.screenshot({ path: join(output, "home-light.png") });
    await verifyThoughtStability(page, output, undefined, "local-light");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
        240,
    );
    await page.getByRole("button", { name: "MyCode", exact: true }).click();
    await page.getByRole("menuitem", { name: /界面主题|Theme/ }).press("ArrowRight");
    await page.getByRole("menuitemradio", { name: /深色|Dark/ }).press("Enter");
    await verifyComposerLayout(page, output);
    // 响应式场景可能收起侧栏，通过现有设置快捷键进入同一页面。
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await page.getByTestId("settings-page").waitFor();
    await verifySettingsCopy(page.getByTestId("settings-page"));
    await verifyGeneralDescriptions(page, output);
    assert.equal(
      await page.getByText(/^(界面模式|Interface mode|办公模式|Office mode)$/).count(),
      0,
    );
    const generalHeading = page.getByRole("heading", { name: /^(常规|General)$/, exact: true });
    assert.doesNotMatch(await generalHeading.locator("../..").innerText(), /中文简体|系统默认/);
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page
        .locator(".settings-compact")
        .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(geometry.scroll <= geometry.client + 1, `settings overflow at ${width}`);
      await page.screenshot({ path: join(output, `settings-${width}.png`) });
    }
    await page.getByRole("button", { name: /^(模型设置|Model settings)$/, exact: true }).click();
    const models = page.getByTestId("model-provider-section");
    await models.getByRole("heading", { name: "HuggingFace", exact: true }).waitFor();
    await verifyProviderHeadings(models);
    assert.equal(await models.locator("nav").count(), 1);
    assert.doesNotMatch(await models.innerText(), /本地模型与 DeepSeek|Local models and DeepSeek/);
    await models.getByRole("button", { name: /刷新模型|Refresh models/ }).click();
    await models.getByRole("button", { name: /保存连接|Save connection/ }).click();
    await models.getByText(/连接设置已保存|Connection saved/).waitFor();
    await page.screenshot({ path: join(output, "models.png") });
    await models.getByTestId("model-provider-add-provider-button").click();
    await models.getByTestId("model-provider-template-picker").waitFor();
    await models.getByTestId("model-provider-template-back-button").click();
    await models.getByRole("heading", { name: "HuggingFace", exact: true }).waitFor();
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await models.evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      assert.ok(geometry.scroll <= geometry.client + 1, `models overflow at ${width}`);
      await page.screenshot({ path: join(output, `models-${width}.png`) });
    }
    await verifyAppearance(page, output);
    await verifyAppearanceDetails(page, output);
    await verifySettingsRefinement(page, output);
    await verifyCapabilitySettings(page, output);
    await nativeWindow.evaluate((win) => win.setBounds({ x: 70, y: 80, width: 890, height: 620 }));
    const savedBounds = await nativeWindow.evaluate((win) => win.getNormalBounds());
    await app.close();
    app = null;
    const files = await readdir(root, { recursive: true });
    assert.equal(
      files.some((file) => file.endsWith("setting.json.lock")),
      false,
    );
    app = await _electron.launch(launchOptions);
    page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (error) => errors.push(error.message));
    const restoredWindow = await app.browserWindow(page);
    const restoredBounds = await restoredWindow.evaluate((win) => win.getNormalBounds());
    assert.deepEqual(restoredBounds, savedBounds);
    await page.locator('[data-testid="composer-model-controls"]').waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-workspace-sidebar-panel]") ||
        document.querySelector("[data-workspace-sidebar-panel]").getBoundingClientRect().width <= 4,
    );
    const sidebarShortcut = process.platform === "darwin" ? "Meta+b" : "Control+b";
    await restoredWindow.evaluate((win) => win.setSize(900, 620));
    await page.keyboard.press(sidebarShortcut);
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
        240,
    );
    await restoredWindow.evaluate((win) => win.setSize(890, 620));
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-workspace-sidebar-panel]") ||
        document.querySelector("[data-workspace-sidebar-panel]").getBoundingClientRect().width <= 4,
    );
    await writeFile(
      join(output, "window-state.json"),
      JSON.stringify({ initialBounds, savedBounds, restoredBounds }, null, 2),
    );
    await page.screenshot({ path: join(output, "restored-narrow-window.png") });
    assert.deepEqual(errors, []);
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(
        {
          passed: true,
          rows,
          homeGeometry,
          neutralMode,
          addGeometry,
          modelGeometry,
          preferencesGeometry,
          initialBounds,
          savedBounds,
          restoredBounds,
          errors,
        },
        null,
        2,
      ),
    );
    console.log("PASS: compact homepage/menu, themes, responsive settings and model connection.");
  }
} catch (error) {
  await writeFile(join(output, "desktop-output.txt"), desktopOutput.join(""));
  await writeFile(join(output, "error.txt"), String(error.stack ?? error));
  await writeFile(join(output, "renderer-errors.json"), JSON.stringify(errors, null, 2));
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
