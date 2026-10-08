import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyInventoryChangeRow(page, output) {
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationInventory } = await f.load("v4/ConversationInventory.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const { MyCodeIntlProvider } = await f.load("i18n/IntlProvider.tsx");
    const context = { workspacePath: "/fixture/default", sessionId: "changes", logEpoch: "1" };
    const rows = [
      { ...f.rows[0], fileChanges: { files: 2, additions: 6053, deletions: 6741 } },
      {
        ...f.rows[1],
        attachments: f.rows[1].attachments.map((a, i) => ({
          ...a,
          fileName: `image-7c313bd9-1234-5678-very-long-screenshot-name-43a1b31852d8-${i}.png`,
        })),
      },
    ];
    const model = buildConversationInventory(rows, context.workspacePath);
    window.__changeFixture = {
      render(locale) {
        f.render({
          empty: true,
          extra: f.h(
            MyCodeIntlProvider,
            { initialLocale: locale, key: locale },
            f.h(
              "div",
              { className: "conversation-reference-surface", "data-change-fixture": "" },
              f.h(
                "aside",
                {
                  "data-testid": "chat-summary-panel",
                  "data-state": "expanded",
                  style: { width: 300 },
                },
                f.h(ConversationInventory, {
                  model,
                  context,
                  rows,
                  hasOlder: false,
                  onLoadAll: async () => ({ status: "hydrated", logEpoch: "1" }),
                  onLocate(rowId) {
                    f.counters.locate++;
                    f.counters.locatedRow = rowId;
                  },
                }),
              ),
            ),
          ),
        });
      },
    };
    window.__changeFixture.render("en-US");
  });
  const fixture = page.locator("[data-change-fixture]");
  const row = fixture.locator("[data-inventory-change]");
  const snapshots = [];
  await fixture.locator("[data-source-name-fade]").first().waitFor();
  const fades = await fixture.locator("[data-source-name-fade]").evaluateAll((nodes) =>
    nodes.map((n) => ({
      text: n.textContent,
      mask: getComputedStyle(n).maskImage,
      whiteSpace: getComputedStyle(n).whiteSpace,
      overflow: n.scrollWidth > n.clientWidth,
    })),
  );
  assert.equal(fades.length, 2);
  assert.ok(
    fades.every(
      (n) =>
        n.overflow &&
        n.mask.includes("linear-gradient") &&
        n.whiteSpace === "nowrap" &&
        n.text.startsWith("image-"),
    ),
    JSON.stringify(fades),
  );
  assert.equal(
    await fixture
      .locator("[data-inventory-view-all]")
      .evaluate((n) => getComputedStyle(n).marginTop),
    "6px",
  );
  for (const locale of ["en-US", "zh-CN", "de-DE"]) {
    await page.evaluate((locale) => window.__changeFixture.render(locale), locale);
    await row.waitFor();
    assert.equal(
      await row.locator("[data-inventory-added]").innerText(),
      `+${new Intl.NumberFormat(locale).format(6053)}`,
    );
    assert.equal(
      await row.locator("[data-inventory-removed]").innerText(),
      `-${new Intl.NumberFormat(locale).format(6741)}`,
    );
    if (locale !== "de-DE")
      assert.equal(
        await row.locator(":scope > span").first().innerText(),
        locale === "zh-CN" ? "变更" : "Changes",
      );
    for (const theme of ["mycode-dark", "mycode-light"]) {
      await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
      for (const size of [14, 18]) {
        await page.evaluate(
          (size) => document.documentElement.style.setProperty("--ui-font-size", `${size}px`),
          size,
        );
        await page.mouse.move(0, 0);
        await page.waitForTimeout(180);
        const m = await row.evaluate((el) => {
          const s = getComputedStyle(el),
            title = el.children[1],
            stats = el.children[2];
          const icon = el.querySelector("[data-diff-icon]");
          const plus = el.querySelector("[data-inventory-added]"),
            minus = el.querySelector("[data-inventory-removed]");
          const canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d");
          const rgb = (color) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const luminance = (color) =>
            rgb(color)
              .map((v) => v / 255)
              .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
              .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
          const background = getComputedStyle(el.closest("aside")).backgroundColor;
          const contrast = (color) => {
            const a = luminance(color),
              b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          const t = getComputedStyle(title),
            p = getComputedStyle(plus);
          return {
            height: el.getBoundingClientRect().height,
            gap: s.columnGap,
            padding: s.paddingBlock,
            radius: s.borderRadius,
            border: s.borderBottomWidth,
            iconWidth: icon.getBoundingClientRect().width,
            leftOffset:
              icon.getBoundingClientRect().left -
              el.closest("section").querySelector("h3").getBoundingClientRect().left,
            iconColor: getComputedStyle(icon).color,
            primary: rgb(s.getPropertyValue("--color-foreground")),
            titleColor: rgb(t.color),
            titleSize: t.fontSize,
            plusSize: p.fontSize,
            minusSize: getComputedStyle(minus).fontSize,
            titleWeight: t.fontWeight,
            plusWeight: p.fontWeight,
            titleFont: t.fontFamily,
            plusFont: p.fontFamily,
            rightGap: el.getBoundingClientRect().right - stats.getBoundingClientRect().right,
            innerIcons: [...icon.querySelectorAll("svg")].map((node) => ({
              width: node.getAttribute("width"),
              computedWidth: getComputedStyle(node).width,
            })),
            plusContrast: contrast(p.color),
            minusContrast: contrast(getComputedStyle(minus).color),
            statsGap: getComputedStyle(stats).columnGap,
            statsEndPadding: getComputedStyle(stats).paddingInlineEnd,
            nextSeparator: el.closest("section").nextElementSibling
              ? getComputedStyle(el.closest("section").nextElementSibling).borderTopWidth
              : "0px",
            titleHeaderSize: getComputedStyle(el.closest("section").querySelector("h3")).fontSize,
            alignedRight:
              stats.getBoundingClientRect().right -
              el
                .closest("section")
                .querySelector("[aria-label='产物菜单'] svg")
                .getBoundingClientRect().right,
          };
        });
        assert.equal(m.height, 28);
        assert.equal(m.gap, "6px");
        assert.equal(m.padding, "0px");
        assert.equal(m.radius, "0px");
        assert.equal(m.border, "1px");
        assert.equal(m.iconWidth, 18);
        assert.equal(m.leftOffset, 0);
        assert.deepEqual(m.titleColor, m.primary);
        assert.ok(Math.abs(parseFloat(m.titleSize) - size * 0.9375) < 0.02);
        assert.equal(m.plusSize, m.titleHeaderSize);
        assert.equal(m.minusSize, m.plusSize);
        assert.equal(m.titleWeight, "400");
        assert.equal(m.plusWeight, "400");
        assert.equal(m.plusFont, m.titleFont);
        assert.ok(m.rightGap <= 2.1 && m.rightGap >= 2);
        assert.equal(m.statsGap, "4px");
        assert.equal(m.nextSeparator, "0px");
        assert.ok(Math.abs(m.alignedRight) <= 1, JSON.stringify(m));
        assert.equal(m.statsEndPadding, "4px");
        assert.ok(
          m.innerIcons.every((icon) => icon.width === "10" && icon.computedWidth === "10px"),
        );
        assert.ok(m.plusContrast >= 4.5, `plus contrast ${m.plusContrast}`);
        assert.ok(m.minusContrast >= 4.5, `minus contrast ${m.minusContrast}`);
        snapshots.push({ locale, theme, size, ...m });
        if (locale !== "de-DE" && size === 14)
          await fixture.screenshot({ path: join(output, `${locale}-${theme}.png`) });
      }
    }
  }
  await row.click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.locate), 1);
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.locatedRow), 1);
  assert.equal(await fixture.getByRole("heading", { name: "Default" }).count(), 1);
  assert.equal(await row.locator(".tabler-icon-file-diff").count(), 0);
  await fixture.getByRole("button", { name: "产物菜单" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Sources" }).count(), 1);
  await page.keyboard.press("Escape");
  return { passed: true, snapshots };
}
