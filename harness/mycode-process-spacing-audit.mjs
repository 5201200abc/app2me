import assert from "node:assert/strict";
import { join } from "node:path";
import { collectProcessMetrics } from "./mycode-process-metrics.mjs";

export async function verifyProcessSpacingAudit(page, fixture, output) {
  const group = fixture.locator('[data-tool-layout-variant="operations"] > [data-process-row]');
  const edit = fixture.locator('[data-row-id="402"] [data-process-row]');
  const multi = fixture.locator('[data-row-id="430"]');
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => {
      window.__typeFixture.applyTheme(theme);
      document.documentElement.style.setProperty("--ui-font-size", "14px");
    }, theme);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(180);
      const metrics = await fixture.evaluate(collectProcessMetrics);
      assert.deepEqual(metrics.statisticGaps, { file: 4, numbers: 3, step: 4, reasoning: 4 });
      assert.deepEqual(metrics.gaps, [8, 0, 0, 0, 0, 8]);
      assert.equal(await fixture.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      const rect = await group.boundingBox();
      assert.equal(rect.height, 24);
      // 行末、距底边 1px 处仍必须命中父行，不能缩成文字或图标的点击范围。
      await group.click({ position: { x: rect.width - 12, y: 23 } });
      assert.equal(await group.getAttribute("aria-expanded"), "true");
      await page.waitForTimeout(350);
      const children = fixture.locator(
        '[data-row-id="410"] [data-process-row], [data-row-id="411"] [data-process-row]',
      );
      const parentBox = await group.boundingBox();
      const parentCopy = await group.locator("[data-process-copy]").boundingBox();
      for (let i = 0; i < 2; i++) {
        const child = children.nth(i);
        const box = await child.boundingBox();
        const icon = await child.locator("[data-process-icon]").boundingBox();
        const text = await child.locator("[data-process-copy]").boundingBox();
        assert.equal(box.y, parentBox.y + 24 * (i + 1));
        assert.equal(icon.x, parentCopy.x);
        assert.equal(text.x - box.x, 22);
      }
      assert.equal(
        await group.locator("[data-process-chevron]").evaluate((el) => getComputedStyle(el).rotate),
        "90deg",
      );
      await page.screenshot({ path: join(output, `compact-expanded-${theme}-${width}.png`) });
      await group.press("Space");
      await page.waitForTimeout(350);

      const colors = () =>
        edit.evaluate((el) => {
          const style = (selector) => {
            const s = getComputedStyle(el.querySelector(selector));
            return { color: s.color, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight };
          };
          return {
            title: style("[data-file-verb]"),
            file: style("[data-file-name]"),
            icon: style("[data-process-icon]"),
            plus: style("[data-file-added]"),
            minus: style("[data-file-removed]"),
          };
        });
      const before = await colors();
      await edit.hover();
      await page.waitForTimeout(180);
      const hovered = await colors();
      assert.notEqual(hovered.title.color, before.title.color);
      assert.equal(hovered.title.color, hovered.file.color);
      assert.equal(hovered.icon.color, before.title.color);
      assert.notEqual(hovered.plus.color, before.plus.color);
      assert.notEqual(hovered.minus.color, before.minus.color);
      for (const key of Object.keys(before)) {
        for (const property of ["font", "size", "weight"])
          assert.equal(hovered[key][property], before[key][property]);
      }
      await edit.focus();
      assert.deepEqual(await colors(), hovered);
      const preview = await page.evaluate(() => window.__typeFixture.counters.preview);
      await edit.locator("button").click();
      assert.equal(await page.evaluate(() => window.__typeFixture.counters.preview), preview + 1);
      assert.equal(await edit.getAttribute("aria-expanded"), "false");
      await edit.press("Enter");
      assert.equal(await edit.getAttribute("aria-expanded"), "true");
      assert.equal(
        await edit
          .locator("[data-process-chevron]")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0.15s",
      );
      await edit.press("Space");
      await page.waitForTimeout(350);

      const parent = multi.locator("[data-process-row]").first();
      await parent.press("Enter");
      const files = multi.locator("[data-tool-file-sentence]");
      await files.first().waitFor();
      await page.waitForTimeout(350);
      assert.equal(await files.count(), 2);
      const parentRect = await parent.boundingBox();
      const parentText = await parent.locator("[data-process-copy]").boundingBox();
      for (let i = 0; i < 2; i++) {
        const file = files.nth(i);
        const box = await file.boundingBox();
        assert.equal(box.y, parentRect.y + 24 * (i + 1));
        assert.equal((await file.locator("[data-process-icon]").boundingBox()).x, parentText.x);
      }
      await parent.press("Space");
      await page.waitForTimeout(350);
    }
  }
}
