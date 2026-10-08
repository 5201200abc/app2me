import { verifyFooterMenu } from "./mycode-footer-preferences-check.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountFooterBarFixture } from "./mycode-footer-bar-fixture.mjs";
import { verifyInventoryChangeRow } from "./mycode-inventory-change-row.mjs";

export async function verifyFooterBarAlignment(page, output, app) {
  await mountFooterBarFixture(page);
  await page.evaluate(() => window.__footerBarFixture.render({ summary: true }));
  const win = await app.browserWindow(page);
  await win.evaluate((w) => w.setBounds({ width: 1900, height: 1300 }));
  await page.evaluate(() => {
    window.__inventoryFixture.host
      .querySelector("main")
      .classList.add("conversation-reference-surface");
  });
  const summary = page.locator('#inventory-tool-fixture [data-testid="chat-summary-panel"]');
  await summary.waitFor();
  const summaryGeometry = await summary.evaluate((el) => ({
    gap: el.closest("main").getBoundingClientRect().right - el.getBoundingClientRect().right,
    width: el.getBoundingClientRect().width,
    expectedWidth: 280,
    margin: getComputedStyle(el).marginInlineEnd,
    right: getComputedStyle(el.parentElement).right,
  }));
  assert.ok(Math.abs(summaryGeometry.gap - 16) <= 1, JSON.stringify(summaryGeometry));
  assert.ok(
    Math.abs(summaryGeometry.width - summaryGeometry.expectedWidth) <= 1,
    JSON.stringify(summaryGeometry),
  );
  assert.equal(summaryGeometry.margin, "0px");
  assert.equal(summaryGeometry.right, "16px");
  await summary.screenshot({ path: join(output, "summary-right-aligned.png") });
  const bar = page.locator("[data-footer-bar-fixture] [data-composer-bottom-bar]");
  const cdp = await page.context().newCDPSession(page);
  const metrics = [];
  for (const scale of [1, 2]) {
    await win.evaluate((w, scale) => w.webContents.setZoomFactor(scale), scale);
    for (const width of [760, 445, 390]) {
      await page.evaluate((width) => window.__footerBarFixture.render({ width }), width);
      await page.waitForFunction(
        (width) =>
          Math.abs(
            document.querySelector("[data-footer-bar-fixture]").getBoundingClientRect().width -
              width,
          ) < 0.1,
        width,
      );
      await bar.locator(".composer-model-trigger").waitFor();
      await page.mouse.move(0, 0);
      for (const theme of ["mycode-dark", "mycode-light"]) {
        await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
        await bar.evaluate(async (el) => {
          await new Promise(requestAnimationFrame);
          await Promise.all(
            el
              .closest("[data-prompt-editor-shell]")
              .getAnimations({ subtree: true })
              .filter((a) => Number.isFinite(a.effect.getComputedTiming().endTime))
              .map((a) => a.finished),
          );
        });
        const m = await bar.evaluate((el) => {
          const box = (s) => {
            const n = el.querySelector(s),
              b = n.getBoundingClientRect();
            return {
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              center: b.y + b.height / 2,
              font: getComputedStyle(n).fontSize,
              weight: getComputedStyle(n).fontWeight,
              color: getComputedStyle(n).color,
              line: getComputedStyle(n).lineHeight,
            };
          };
          const add = box("[data-composer-add]"),
            model = box(".composer-model-trigger"),
            permission = box(".composer-permission-trigger"),
            usage = box('[data-testid="chat-context-usage-trigger"]'),
            send = box('[data-testid="v4-composer-send"]');
          const buttons = [add, model, permission, usage, send];
          return {
            rect: el.getBoundingClientRect().toJSON(),
            leading: [
              "[data-composer-leading-actions]",
              "[data-composer-leading-content]",
              "[data-composer-leading-content] > span",
              '[data-testid="composer-model-controls"]',
            ].map((selector) => ({
              selector,
              ...box(selector),
              flex: getComputedStyle(el.querySelector(selector)).flex,
            })),
            padding: getComputedStyle(el).paddingInline,
            insets: (() => {
              const shell = el.closest("[data-prompt-editor-shell]").getBoundingClientRect();
              return [
                add.x - shell.left,
                shell.right - send.x - send.width,
                shell.bottom - send.y - send.height,
              ];
            })(),
            manualOffset: [getComputedStyle(el).marginInlineStart, getComputedStyle(el).transform],
            add,
            model,
            permission,
            usage,
            send,
            icons: [...el.querySelectorAll("svg,[data-model-logo]")].map((n) => ({
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
              arrow: n.hasAttribute("data-bar-chevron"),
              modelLogo: n.hasAttribute("data-model-logo"),
              display: getComputedStyle(n).display,
              modelArrow: Boolean(n.closest(".composer-model-tail")),
              stroke: getComputedStyle(n).strokeWidth,
              viewBox: n.getAttribute("viewBox"),
              color: getComputedStyle(n).color,
            })),
            name: box(".composer-model-name"),
            label: box(".composer-permission-label"),
            subFont: getComputedStyle(el.querySelector("[data-composer-thought-summary]")).fontSize,
            subDisplay: getComputedStyle(el.querySelector("[data-composer-thought-summary]"))
              .display,
            baseline: getComputedStyle(el.querySelector(".composer-model-text")).alignItems,
            innerGap: getComputedStyle(el.querySelector(".composer-model-trigger")).columnGap,
            textGap: getComputedStyle(el.querySelector(".composer-model-text")).columnGap,
            arrowGap: getComputedStyle(el.querySelector(".composer-model-tail")).columnGap,
            separator: getComputedStyle(
              el.querySelector("[data-composer-thought-summary]"),
              "::before",
            ).content,
            nowrap: getComputedStyle(el.querySelector(".composer-model-tail")).flexWrap,
            gaps: [
              model.x - add.x - add.width,
              usage.x - model.x - model.width,
              send.x - permission.x - permission.width,
            ],
            centers:
              Math.max(...buttons.map((b) => b.center)) - Math.min(...buttons.map((b) => b.center)),
            overflow:
              el.scrollWidth > el.clientWidth ||
              buttons.some((b) => b.x + b.width > el.getBoundingClientRect().right + 1),
          };
        });
        for (const key of ["add", "model", "permission", "usage"])
          assert.ok(Math.abs(m[key].height - (28 * 16) / 15) < 0.1, key);
        assert.ok(Math.abs(m.send.height - (28 * 16) / 15) < 0.1);
        assert.ok(Math.abs(m.rect.height - (28 * 16) / 15) < 0.1);
        assert.equal(m.padding, "0px");
        assert.ok(Math.abs(m.add.width - (28 * 16) / 15) < 0.1);
        assert.equal(m.add.x - m.rect.x, 0);
        assert.ok(
          m.insets.every((n) => Math.abs(n - 12.8) < 0.1),
          JSON.stringify(m),
        );
        assert.deepEqual(m.manualOffset, ["0px", "none"]);
        assert.equal(m.send.color, "rgb(255, 255, 255)");
        assert.ok(m.permission.x > m.usage.x + m.usage.width, JSON.stringify(m));
        assert.equal(m.name.font, "15px");
        assert.equal(m.label.font, "15px");
        assert.equal(m.name.weight, "400");
        assert.ok(
          Math.abs(Number.parseFloat(m.subFont) / Number.parseFloat(m.name.font) - 1) < 0.01,
        );
        assert.equal(m.baseline, "baseline");
        assert.ok(Math.abs(Number.parseFloat(m.innerGap) - (4 * 16) / 15) < 0.02);
        assert.ok(Math.abs(Number.parseFloat(m.textGap) - (4 * 16) / 15) < 0.02);
        assert.ok(Math.abs(Number.parseFloat(m.arrowGap) - (4 * 16) / 15) < 0.02);
        assert.ok(m.centers <= 1, JSON.stringify(m));
        assert.equal(m.overflow, false, JSON.stringify(m));
        assert.deepEqual(
          m.gaps.map((gap) => Math.round(gap)),
          [2, 2, 6],
        );
        assert.equal(m.subDisplay, "flex");
        assert.equal(m.separator, '"·"');
        assert.equal(m.nowrap, "nowrap");
        for (const icon of m.icons) {
          if (icon.arrow) {
            assert.equal(icon.display, "none");
            assert.equal(icon.width, 0);
            continue;
          }
          const expected = icon.modelLogo ? 18 : (14 * 16) / 15;
          assert.ok(Math.abs(icon.width - expected) < 0.1, JSON.stringify(icon));
          assert.ok(Math.abs(icon.height - expected) < 0.1, JSON.stringify(icon));
          if (icon.viewBox) assert.equal(icon.stroke, "1.5px");
        }
        metrics.push({ scale, width, theme, ...m });
        const capture = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        await writeFile(
          join(output, `bar-${width}-${scale}x-${theme}.png`),
          Buffer.from(capture.data, "base64"),
        );
      }
    }
  }
  await win.evaluate((w) => w.webContents.setZoomFactor(1));
  await page.evaluate(() => window.__footerBarFixture.render({ width: 390, long: true }));
  assert.equal(await bar.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  await page.evaluate(() => window.__footerBarFixture.render({ width: 760, reasoning: false }));
  await page.waitForFunction(
    () => !document.querySelector("[data-footer-bar-fixture] [data-composer-thought-summary]"),
  );
  assert.equal(await bar.locator("[data-composer-thought-summary]").count(), 0);
  await bar.screenshot({ path: join(output, "model-without-reasoning.png") });
  await page.evaluate(() => window.__footerBarFixture.render({ width: 760 }));
  await page.evaluate(() => window.__footerBarFixture.render({ width: 760, draft: true }));
  await page.waitForFunction(() =>
    Boolean(document.querySelector("[data-composer-project-controls]")),
  );
  assert.equal(await bar.locator(".composer-permission-trigger").count(), 1);
  assert.equal(
    await page.locator("[data-composer-project-controls] .composer-permission-trigger").count(),
    0,
  );
  assert.equal(
    await bar.locator("[data-composer-submit-controls] .composer-permission-trigger").count(),
    1,
  );
  await page.screenshot({ path: join(output, "draft-permission-before-send.png") });
  await page.evaluate(() => window.__footerBarFixture.render({ width: 760 }));
  await page.waitForFunction(() => !document.querySelector("[data-composer-project-controls]"));
  await bar.locator('[data-testid="v4-composer-send"]').click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.send), 1);
  await bar.locator(".composer-permission-trigger").click();
  await page.getByRole("menuitemradio").first().click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.mode), 1);
  await page.keyboard.press("Escape");
  await bar.locator(".composer-model-trigger").click();
  await page.getByRole("menu").last().waitFor();
  await page.keyboard.press("Escape");
  await bar.locator("[data-composer-add]").click();
  await page.getByText("添加附件", { exact: true }).click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.add), 1);
  await page.keyboard.press("Escape");
  const context = bar.getByTestId("chat-context-usage-trigger");
  assert.equal(await context.count(), 1);
  await context.hover();
  await page.getByText("上下文窗口", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "context-next-to-permission.png") });
  await page.mouse.move(0, 0);
  await page.getByText("上下文窗口", { exact: true }).waitFor({ state: "hidden" });
  const states = [];
  for (const selector of [
    "[data-composer-add]",
    ".composer-model-trigger",
    ".composer-permission-trigger",
    '[data-testid="chat-context-usage-trigger"]',
    '[data-testid="v4-composer-send"]',
  ]) {
    const button = bar.locator(selector);
    await button.hover();
    await button.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const state = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      const expected = document.createElement("span");
      expected.style.color = s.color;
      expected.style.backgroundColor =
        el.matches('[data-testid="v4-composer-send"]') &&
        document.documentElement.classList.contains("theme-mycode-dark")
          ? "color-mix(in srgb, var(--conversation-send, var(--color-brand)) 90%, var(--color-foreground) 10%)"
          : el.matches(".composer-permission-trigger")
            ? "color-mix(in srgb, var(--bar-orange) 10%, transparent)"
            : "color-mix(in srgb, currentColor 6%, transparent)";
      el.append(expected);
      const background = getComputedStyle(expected).backgroundColor;
      expected.remove();
      return {
        actual: s.backgroundColor,
        background,
        duration: s.transitionDuration,
        radius: s.borderRadius,
      };
    });
    assert.equal(state.actual, state.background);
    assert.ok(state.duration.split(", ").every((d) => d === "0.12s"));
    assert.equal(state.radius, selector.includes("v4-composer-send") ? "50%" : "6px");
    await page.keyboard.press("Escape");
    await button.focus();
    const focus = await button.evaluate((el) => ({
      visible: el.matches(":focus-visible"),
      width: getComputedStyle(el).outlineWidth,
      style: getComputedStyle(el).outlineStyle,
    }));
    assert.ok(focus.visible);
    assert.equal(focus.width, "2px");
    assert.equal(focus.style, "solid");
    states.push({ selector, state, focus });
  }
  await page.evaluate(() => window.__footerBarFixture.render({ width: 760, disabled: true }));
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("[data-footer-bar-fixture] .composer-model-trigger"))
        .opacity === "0.4",
  );
  assert.equal(
    await bar
      .locator('[data-testid="v4-composer-send"] svg')
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  const disabled = await bar
    .locator("button:disabled")
    .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).opacity));
  assert.ok(disabled.every((s) => s === "0.4"));
  await verifyFooterMenu(page, output);
  const sources = await verifySourceAlignment(page, output);
  const changes = await verifyInventoryChangeRow(page, output);
  return { passed: true, metrics, states, sources, changes };
}

async function verifySourceAlignment(page, output) {
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationInventory } = await f.load("v4/ConversationInventory.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const context = {
      workspacePath: "/fixture/default",
      sessionId: "sources",
      logEpoch: "1",
      readAttachment: async () => ({
        bytes: Uint8Array.from(atob(f.png), (c) => c.charCodeAt(0)),
        mediaType: "image/png",
      }),
    };
    f.render({
      empty: true,
      platform: {
        getDesktopToolEnvironment: async () => ({
          bundledPaths: [],
          nodePath: "/fixture/node",
          nodeVersion: "fixture",
          bundleVersion: "fixture",
        }),
      },
      extra: f.h(
        "div",
        {
          className: "conversation-reference-surface",
          "data-source-alignment-fixture": "",
          style: { width: 280 },
        },
        f.h(ConversationInventory, {
          model: buildConversationInventory(f.rows, context.workspacePath),
          context,
          rows: f.rows,
          hasOlder: false,
          onLocate: () => {},
          onLoadAll: async () => ({ status: "hydrated", logEpoch: "1" }),
        }),
      ),
    });
  });
  const fixture = page.locator("[data-source-alignment-fixture]");
  await fixture.locator("img").first().waitFor();
  const summary = fixture.locator("[data-source-kind] > button,[data-source-summary-row]");
  const rows = await summary.evaluateAll((nodes) =>
    nodes.map((n) => {
      const icon = n.firstElementChild,
        text = n.children[1];
      return {
        icon: icon.getBoundingClientRect().toJSON(),
        text: text.getBoundingClientRect().toJSON(),
        height: n.getBoundingClientRect().height,
        padding: getComputedStyle(n).paddingLeft,
      };
    }),
  );
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((r) => r.icon.left)).size, 1);
  assert.equal(new Set(rows.map((r) => r.text.left)).size, 1);
  for (const r of rows) {
    assert.equal(r.icon.width, 16);
    assert.equal(r.icon.height, 16);
    assert.equal(r.height, 28);
    assert.equal(r.text.left - r.icon.right, 8);
    assert.equal(r.padding, "0px");
  }
  const header = await fixture.locator("[data-inventory-source-title]").boundingBox();
  assert.equal(header.x, rows[0].icon.left);
  await fixture.screenshot({ path: join(output, "sources-aligned.png") });
  await fixture.getByText("Mycode App Tools", { exact: true }).click();
  await page.locator("[data-sources-side-pane]").waitFor();
  await page.keyboard.press("Escape");
  return rows;
}
