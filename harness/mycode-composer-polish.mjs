import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyComposerPolish(page, output) {
  const composer = page.getByTestId("v4-composer");
  const project = composer.getByTestId("composer-workspace-trigger");
  const permission = composer.getByTestId("chat-mode-select-trigger");
  const add = composer.getByRole("button", { name: /^(添加上下文|Add context)$/ });
  const model = composer.getByTestId("composer-model-controls");
  assert.equal(await permission.count(), 1);
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const [p, access, plus, models] = await Promise.all([
      project.boundingBox(),
      permission.boundingBox(),
      add.boundingBox(),
      model.boundingBox(),
    ]);
    assert.ok(access.x >= p.x + p.width && Math.abs(access.y - p.y) < 3);
    assert.ok(models.x >= plus.x + plus.width && Math.abs(models.y - plus.y) < 5);
    assert.ok(access.y < plus.y);
    await project.click();
    const menu = page.locator(".composer-workspace-menu");
    await menu.waitFor();
    assert.ok((await menu.boundingBox()).width <= 248);
    const search = menu.locator('[data-slot="command-input"]');
    await search.fill("missing-project-e2e");
    await menu.getByText(/暂无内容|No matching workspaces/).waitFor();
    assert.ok((await search.boundingBox()).height <= 28);
    const rows = await menu.locator('[role^="menuitem"]').evaluateAll((items) =>
      items.map((el) => ({
        height: el.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
      })),
    );
    assert.ok(rows.every((row) => row.height <= 28 && row.font === "12px"));
    await page.screenshot({ path: join(output, `project-picker-polish-${width}.png`) });
    await menu.getByTestId("composer-work-outside-project").click();
    await menu.waitFor({ state: "detached" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const toggle = page.getByRole("button", { name: /切换侧边栏|Toggle sidebar/ }).first();
  const icon = toggle.locator("svg");
  assert.ok((await icon.boundingBox()).width === 14);
  assert.equal(await icon.getAttribute("stroke-width"), "1.5");
  assert.equal(await icon.locator("path").count(), 1);
  if ((await page.locator("[data-workspace-sidebar-panel]").boundingBox()).width < 200) {
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
        240,
    );
  }
  assert.equal(await page.getByRole("tab", { name: "全部", exact: true }).count(), 1);
  await toggle.click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width <= 4,
  );
  await toggle.click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
      240,
  );
}

export async function verifyAgentPresentation(settings) {
  const main = settings.locator(
    'main:is([data-settings-group="integrations"], [data-settings-group="coding"], [data-settings-group="tools"])',
  );
  assert.equal(await main.count(), 1);
  const typography = await main
    .locator('[class*="text-ui-"]')
    .evaluateAll((items) =>
      items
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => getComputedStyle(el).fontSize),
    );
  assert.ok(typography.length > 0 && typography.every((size) => size === "12px"));
  const headings = await main
    .locator('h3, [data-settings-resource-title], [role="tab"]')
    .allTextContents();
  assert.ok(headings.every((text) => !/\d+\s*(?:项)?\s*$/.test(text.trim())));
  const switches = await main.getByRole("switch").evaluateAll((items) =>
    items
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
  );
  assert.ok(
    switches.every(
      (item) =>
        (item.width === 28 && item.height === 16) || (item.width === 26 && item.height === 14),
    ),
  );
}

export async function verifyAgentPopupTypography(popup) {
  const sizes = await popup
    .locator('[class*="text-ui-"]')
    .evaluateAll((items) =>
      items
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => getComputedStyle(el).fontSize),
    );
  assert.ok(sizes.length > 0 && sizes.every((size) => size === "12px"));
}

export async function verifyMemorySwitch(settings) {
  const toggle = settings.getByRole("switch", { name: "记忆", exact: true });
  const before = await toggle.getAttribute("aria-checked");
  await toggle.focus();
  await toggle.press("Space");
  await toggle
    .page()
    .waitForFunction(
      (before) =>
        document
          .querySelector('[data-testid="settings-memory-switch"]')
          .getAttribute("aria-checked") !== before,
      before,
    );
  await toggle.press("Space");
  await toggle
    .page()
    .waitForFunction(
      (before) =>
        document
          .querySelector('[data-testid="settings-memory-switch"]')
          .getAttribute("aria-checked") === before,
      before,
    );
  assert.equal(await toggle.getAttribute("aria-checked"), before);
}
