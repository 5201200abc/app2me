import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyCompactProjectControls(page, output) {
  const toggle = page.getByRole("button", { name: /切换侧边栏|Toggle sidebar/ }).first();
  await toggle.click();
  const settingsButton = page.getByTestId("desktop-top-settings");
  await settingsButton.waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width <= 4,
  );
  const newConversation = page.getByTestId("desktop-top-new-task");
  const [n, s] = await Promise.all([newConversation.boundingBox(), settingsButton.boundingBox()]);
  assert.ok(n.x + n.width <= s.x);
  await settingsButton.click();
  await page.getByTestId("settings-page").waitFor();
  await page
    .getByRole("button", { name: /返回工作区|Back to workspace/ })
    .first()
    .click();
  await page.getByTestId("v4-composer").waitFor();
  await toggle.click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
      240,
  );
  assert.equal(await settingsButton.count(), 0);

  const sort = page.getByTestId("sidebar-task-sort");
  await sort.click();
  const menu = page.locator(".sidebar-task-view-menu");
  await menu.waitFor();
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  assert.ok((await menu.boundingBox()).width <= 178);
  const rows = await menu.getByRole("menuitemradio").evaluateAll((items) =>
    items.map((el) => ({
      height: el.getBoundingClientRect().height,
      font: getComputedStyle(el).fontSize,
      icon: el.querySelector("svg").getBoundingClientRect().width,
    })),
  );
  assert.ok(rows.every((row) => row.height <= 26 && row.font === "12px" && row.icon === 14));
  await page.screenshot({ path: join(output, "compact-task-view-menu.png") });
  await menu.getByRole("menuitemradio", { name: "创建时间", exact: true }).click();
  await menu.waitFor({ state: "detached" });
  await sort.click();
  await menu
    .getByRole("menuitemradio", { name: "创建时间", exact: true })
    .getAttribute("aria-checked")
    .then((value) => assert.equal(value, "true"));
  await menu.getByRole("menuitemradio", { name: "更新时间", exact: true }).click();
  await menu.waitFor({ state: "detached" });

  const composer = page.getByTestId("v4-composer");
  const project = composer.getByTestId("composer-workspace-trigger");
  const permission = composer.getByTestId("chat-mode-select-trigger");
  const remote = composer.getByTestId("composer-remote-connection");
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const [p, mode, r] = await Promise.all([
      project.boundingBox(),
      permission.boundingBox(),
      remote.boundingBox(),
    ]);
    assert.ok(mode.x >= p.x + p.width && r.x >= mode.x + mode.width);
    assert.ok(Math.abs(mode.y - r.y) <= 1);
    await project.click();
    const picker = page.locator(".composer-workspace-menu");
    const search = picker.getByPlaceholder("搜索", { exact: true });
    await search.fill("unmatched-workspace-e2e");
    await picker.getByText("暂无内容", { exact: true }).waitFor();
    assert.equal(await picker.getByTestId("composer-remote-connection").count(), 0);
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached" });
    await permission.click();
    const permissions = page.locator(".composer-permission-menu");
    await permissions.waitFor();
    await permissions.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const choices = await permissions.getByRole("menuitemradio").evaluateAll((items) =>
      items.map((el) => ({
        height: el.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
        icon: el.querySelector("svg").getBoundingClientRect().width,
        stroke:
          el.querySelector("svg").getAttribute("stroke-width") ??
          getComputedStyle(el.querySelector("svg")).strokeWidth,
      })),
    );
    assert.equal(choices.length, 3);
    assert.ok(
      choices.every((row) => row.height <= 44 && row.font === "12px" && row.icon === 14),
      JSON.stringify(choices),
    );
    await page.screenshot({ path: join(output, `compact-permissions-${width}.png`) });
    await page.keyboard.press("Escape");
    await permissions.waitFor({ state: "detached" });
    await remote.click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  if ((await page.locator("[data-workspace-sidebar-panel]").boundingBox()).width <= 4)
    await toggle.click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-sidebar-panel]")?.getBoundingClientRect().width ===
      240,
  );
  const model = composer.getByTestId("chat-model-select-trigger");
  assert.equal((await model.boundingBox()).height, 26);
  assert.equal(await model.evaluate((el) => getComputedStyle(el).fontSize), "12px");
  assert.equal((await model.locator("[data-model-logo]").boundingBox()).width, 12);
  const footer = page.locator(".workspace-sidebar-footer");
  assert.equal((await footer.locator('[data-slot="avatar"]').boundingBox()).width, 22);
  assert.equal(
    await footer
      .getByText("MyCode", { exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  const icons = await footer
    .locator("button svg")
    .evaluateAll((items) => items.map((el) => el.getBoundingClientRect().width));
  assert.ok(icons.every((size) => size === 12));
  await page.screenshot({ path: join(output, "compact-project-controls.png") });
}
