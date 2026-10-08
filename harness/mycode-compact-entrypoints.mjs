import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyGoalToolbar(page, output) {
  const currentPermissionBounds = await page.getByTestId("chat-mode-select-trigger").boundingBox();
  const goalMarker = page.getByTestId("composer-goal-marker");
  await goalMarker.waitFor();
  const goalBounds = await goalMarker.boundingBox();
  assert.ok(goalBounds.x >= currentPermissionBounds.x + currentPermissionBounds.width);
  const input = page.getByTestId("v4-composer-input");
  assert.doesNotMatch(await input.innerText(), /goal/i);
  await input.focus();
  await page.keyboard.type("keep this draft");
  assert.match(
    await input.evaluate((el) => el.__mycodeLexicalInputE2E.getText()),
    /^\/goal\s+keep this draft$/,
  );
  await goalMarker.getByRole("button").click();
  await goalMarker.waitFor({ state: "detached" });
  assert.equal(
    await input.evaluate((el) => el.__mycodeLexicalInputE2E.getText()),
    "keep this draft",
  );
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await goalMarker.waitFor();
  assert.match(
    await input.evaluate((el) => el.__mycodeLexicalInputE2E.getText()),
    /^\/goal\s+keep this draft$/,
  );
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  const copied = await input.evaluate((el) => {
    const event = new ClipboardEvent("copy", {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.clipboardData.getData("text/plain");
  });
  assert.match(copied, /^\/goal\s+keep this draft$/);
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: join(output, "goal-toolbar.png") });
  await page.getByRole("button", { name: /^(添加上下文|Add context)$/ }).click();
  assert.equal(await page.locator('[data-trigger="+"] code').count(), 0);
  await page.getByTestId("composer-add-plan").click();
  const plan = page.getByTestId("v4-composer-plan-marker");
  await plan.waitFor();
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 900)
      await page.waitForFunction(
        () =>
          document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width <=
          4,
      );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const permission = await page.getByTestId("chat-mode-select-trigger").boundingBox();
    const planBox = await plan.boundingBox();
    const goalBox = await goalMarker.boundingBox();
    assert.ok(planBox.x >= permission.x + permission.width);
    assert.ok(goalBox.x >= planBox.x + planBox.width);
    const buttons = await page
      .getByTestId("v4-composer")
      .locator("button:visible")
      .evaluateAll((items) =>
        items.map((el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
        })),
      );
    assert.ok(buttons.every((rect) => rect.left >= 0 && rect.right <= width));
    await page.screenshot({ path: join(output, `goal-plan-${width}.png`) });
  }
  await page.getByRole("button", { name: /关闭计划模式|Turn off Plan mode/ }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
      240,
  );
}

export async function verifyHelpMenu(app, page, output) {
  const help = page.getByTestId("workspace-help-menu-trigger");
  assert.equal(await help.count(), 1);
  assert.equal(await help.locator("xpath=ancestor::footer").count(), 1);
  await help.click();
  const helpMenu = page.locator(".workspace-help-menu");
  await helpMenu.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".workspace-help-menu")
      ?.getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  assert.equal((await helpMenu.boundingBox()).width, 176);
  const helpGeometry = await helpMenu.getByRole("menuitem").evaluateAll((items) =>
    items.map((el) => ({
      font: getComputedStyle(el).fontSize,
      height: el.getBoundingClientRect().height,
    })),
  );
  assert.ok(helpGeometry.every((row) => row.font === "12px" && row.height === 28));
  await page.screenshot({ path: join(output, "help-menu.png") });
  const aboutWindow = app.waitForEvent("window");
  await helpMenu.getByRole("menuitem", { name: /关于 MyCode|About MyCode/ }).click();
  const about = await aboutWindow;
  await about.locator(".app-logo").waitFor();
  assert.doesNotMatch(await about.locator("body").innerText(), /Apple|优化|Optimized/);
  assert.deepEqual(
    await about
      .locator(".app-logo path")
      .evaluateAll((paths) => paths.map((path) => path.getAttribute("d"))),
    await page
      .getByTestId("v4-draft-brand")
      .locator("path")
      .evaluateAll((paths) => paths.map((path) => path.getAttribute("d"))),
  );
  const aboutBounds = await (await app.browserWindow(about)).evaluate((win) => win.getBounds());
  assert.equal(aboutBounds.width, 264);
  // macOS modal sheet 会调整原生高度；验收实际内容完整且窗口保持紧凑。
  assert.ok(aboutBounds.height >= 200 && aboutBounds.height <= 248);
  const aboutLayout = await about.locator(".about-card").evaluate((el) => {
    const meta = el.querySelector(".meta").getBoundingClientRect();
    const button = el.querySelector(".ok-button").getBoundingClientRect();
    return {
      metaBottom: meta.bottom,
      buttonTop: button.top,
      buttonBottom: button.bottom,
      height: innerHeight,
    };
  });
  assert.ok(aboutLayout.metaBottom <= aboutLayout.buttonTop);
  assert.ok(aboutLayout.buttonBottom <= aboutLayout.height);
  await about.screenshot({ path: join(output, "about.png") });
  await about.getByRole("button", { name: /确定|OK/ }).click();
  await page.bringToFront();
}

export async function verifyAppearance(page, output) {
  await page.getByRole("button", { name: /^(外观|Appearance)$/, exact: true }).click();
  assert.equal(
    await page
      .getByText(
        /^(界面设置|Interface Setting|设置应用主题和界面文字大小。|Choose the app theme and interface text size\.)$/,
      )
      .count(),
    0,
  );
  await page.getByRole("combobox").first().waitFor();
  const fontSize = page.getByRole("group", { name: /界面字号|UI font size/ });
  await fontSize.waitFor();
  const originalFontSize = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui-font-size").trim(),
  );
  await fontSize.getByRole("button", { name: /-1 px$/ }).click();
  await page.waitForFunction(
    (original) =>
      getComputedStyle(document.documentElement).getPropertyValue("--ui-font-size").trim() ===
      `${Number.parseInt(original) - 1}px`,
    originalFontSize,
  );
  await fontSize.getByRole("button", { name: /\+1 px$/ }).click();
  await page.waitForFunction(
    (original) =>
      getComputedStyle(document.documentElement).getPropertyValue("--ui-font-size").trim() ===
      original,
    originalFontSize,
  );
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /浅色|Light/ }).click();
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("theme-mycode-light"),
  );
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /深色|Dark/ }).click();
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("theme-mycode-dark"),
  );
  assert.equal(
    await page
      .getByTestId("settings-page")
      .getByTestId("workspace-help-menu-trigger")
      .locator("xpath=ancestor::footer")
      .count(),
    1,
  );
  await page
    .getByRole("heading", { name: /^(外观|Appearance)$/, exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "appearance.png") });
}

export async function verifyModelMenu(page, output) {
  assert.equal(await page.getByText(/^(选择模型|Choose model)$/, { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-model-footer-action="manage-models"]').count(), 0);
  const modelRows = page.locator('[data-testid^="chat-model-select-item-"]');
  await modelRows.first().waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="menu"]')
      ?.getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  const modelGeometry = await modelRows.evaluateAll((items) =>
    items.map((el) => {
      const logo = el.querySelector("[data-model-logo]");
      const name = el.querySelector("[title]");
      return {
        font: getComputedStyle(name).fontSize,
        weight: getComputedStyle(name).fontWeight,
        logo: logo.getBoundingClientRect().width,
      };
    }),
  );
  assert.ok(modelGeometry.length > 0);
  assert.ok(
    modelGeometry.every((row) => row.font === "12px" && row.weight === "400" && row.logo === 12),
  );
  const huggingfaceGroup = page.getByText("HuggingFace", { exact: true });
  await huggingfaceGroup.waitFor();
  assert.equal(
    await page
      .locator('[data-slot="dropdown-menu-label"]')
      .filter({ hasText: /^HuggingFace$/ })
      .locator("[data-model-logo]")
      .count(),
    0,
  );
  await page.screenshot({ path: join(output, "model-menu.png") });
  await page.keyboard.press("Escape");
  return modelGeometry;
}

export async function verifyProviderHeadings(models) {
  const hf = models.getByRole("heading", { name: "HuggingFace", exact: true });
  assert.equal(await hf.locator("img,[data-model-logo]").count(), 0);
  assert.doesNotMatch(
    await models.innerText(),
    /模型目录|请求模型 ID|思考：|文件识别不等于|Model directory|Request model ID|Thinking:/,
  );
  await models.getByTestId("model-provider-add-provider-button").click();
  await models.getByTestId("model-provider-template-item-deepseek").click();
  const nav = models.getByRole("navigation");
  await nav.getByRole("button", { name: "DeepSeek", exact: true }).waitFor();
  const deepseek = models.getByTestId("model-provider-header").filter({ hasText: /^DeepSeek$/ });
  await deepseek.waitFor();
  assert.equal(await deepseek.locator("img,[data-model-logo]").count(), 0);
  assert.equal(await hf.count(), 0);
  const icons = await nav.locator("img").evaluateAll((items) =>
    items.map((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      loaded: el.complete && el.naturalWidth > 0,
      filter: getComputedStyle(el).filter,
    })),
  );
  assert.equal(icons.length, 2);
  assert.ok(
    icons.every(
      (icon) => icon.width === 20 && icon.height === 20 && icon.loaded && icon.filter === "none",
    ),
  );
  await nav.getByRole("button", { name: "HuggingFace", exact: true }).click();
  await hf.waitFor();
  assert.equal(await deepseek.count(), 0);
}
