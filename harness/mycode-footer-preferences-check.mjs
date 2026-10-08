import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyFooterMenu(page, output) {
  const footer = page.locator("[data-footer-stage]");
  assert.equal(await footer.getByRole("button", { name: "设置", exact: true }).count(), 0);
  await footer.getByRole("button", { name: "MyCode", exact: true }).click();
  const menu = page.getByRole("menu").first();
  const usage = menu.getByRole("menuitem", { name: "使用统计", exact: true });
  assert.equal(await usage.locator(".tabler-icon-chart-bar").count(), 1);
  const help = menu.getByRole("menuitem", { name: "帮助", exact: true });
  assert.equal(await help.locator(".tabler-icon-help").count(), 1);
  const settings = menu.getByRole("menuitem", { name: "设置", exact: true });
  assert.equal(await settings.locator(".tabler-icon-settings").count(), 1);
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const boxes = await Promise.all([usage, help, settings].map((row) => row.boundingBox()));
  assert.ok(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y);
  assert.ok(
    boxes.every((b) => Math.abs(b.height - 24) < 0.1),
    JSON.stringify(boxes),
  );
  const lefts = await Promise.all(
    [usage, help, settings].map((row) =>
      row
        .locator("svg")
        .first()
        .evaluate((svg) => svg.getBoundingClientRect().left),
    ),
  );
  assert.equal(new Set(lefts).size, 1);
  await menu.screenshot({ path: join(output, "profile-menu.png") });
  await settings.click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.settings), 1);
  await footer.getByRole("button", { name: "MyCode", exact: true }).click();
  await usage.click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.usage), 1);
  await footer.getByRole("button", { name: "MyCode", exact: true }).click();
  await help.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitem", { name: "产品文档", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.docs), 1);
}
