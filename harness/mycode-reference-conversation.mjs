import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mountReferenceConversation } from "./mycode-reference-fixture.mjs";
import { verifySummaryToggle } from "./mycode-summary-toggle-fixture.mjs";

export async function verifyReferenceConversation(page, app, output) {
  const native = await app.browserWindow(page);
  await native.evaluate((win) => win.setBounds({ width: 1512, height: 982 }));
  await page.setViewportSize({ width: 1512, height: 982 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1512,
    height: 982,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const destination = resolve(".artifacts/conversation-reference");
  await mkdir(destination, { recursive: true });
  const captureRetina = async (name) => {
    const capture = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1512, height: 982, scale: 1 },
    });
    const png = Buffer.from(capture.data, "base64");
    assert.equal(png.readUInt32BE(16), 3024);
    assert.equal(png.readUInt32BE(20), 1964);
    await writeFile(join(destination, name), png);
  };
  await page.evaluate(mountReferenceConversation, process.cwd());
  const fixture = page.locator("#reference-conversation-fixture");
  await fixture.locator("[data-reference-column]").waitFor();
  await page.evaluate(() => window.__referenceFixture.mountComposer());
  const work = fixture.locator(".conversation-work-summary button");
  const panel = fixture.getByTestId("chat-summary-panel");
  try {
    assert.equal(await work.count(), 1);
    assert.equal(await work.getAttribute("aria-expanded"), "false");
    assert.match(await work.innerText(), /已工作 11m 22s/);
    const geometry = await fixture.evaluate((el) => {
      const measure = (node) => {
        const rect = node.getBoundingClientRect(),
          style = getComputedStyle(node);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          color: style.color,
          background: style.backgroundColor,
          font: style.fontSize,
          weight: style.fontWeight,
          lineHeight: style.lineHeight,
          radius: style.borderRadius,
          border: style.borderWidth,
          shadow: style.boxShadow,
          padding: style.padding,
        };
      };
      const select = (selector) => measure(el.querySelector(selector));
      const sidebar =
        document.querySelector('[data-testid="workspace-sidebar"]') ??
        document.querySelector(".workspace-sidebar-footer");
      return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        surface: measure(el),
        column: select("[data-reference-column]"),
        bubble: select(".conversation-user-bubble"),
        answer: select(".conversation-answer"),
        panel: select('[data-testid="chat-summary-panel"]'),
        composer: select("[data-prompt-editor-shell]"),
        placeholder: select("[data-composer-placeholder]"),
        send: select('[data-testid="v4-composer-send"]'),
        model: select('[data-testid="composer-model-controls"]'),
        permission: select('[data-testid="chat-mode-select-trigger"]'),
        capacity: select('[data-testid="chat-context-usage-trigger"]'),
        work: select(".conversation-work-summary"),
        source: select("[data-source-kind]"),
        sidebar: sidebar ? measure(sidebar) : null,
        paragraphs: [...el.querySelectorAll(".conversation-answer p")].map(measure),
        metadata: select("[data-v4-user-input-meta]"),
        actions: select(".conversation-message-actions"),
        actionIcons: [...el.querySelectorAll(".conversation-message-actions svg")].map(measure),
      };
    });
    await writeFile(join(destination, "geometry.json"), JSON.stringify(geometry, null, 2));
    await page.mouse.move(0, 0);
    await captureRetina("mycode.png");
    const capacityTrigger = fixture.getByTestId("chat-context-usage-trigger");
    await capacityTrigger.click();
    assert.equal(await page.getByText("平均缓存命中率", { exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__referenceFixture.setContextDetails(true));
    await capacityTrigger.click();
    await page.getByText("平均缓存命中率", { exact: true }).waitFor();
    await page.getByText("90%", { exact: true }).first().waitFor();
    assert.ok((await page.getByText("系统提示词", { exact: true }).count()) > 0);
    await page
      .locator('[data-slot="hover-card-content"]')
      .filter({ hasText: "平均缓存命中率" })
      .evaluate(async (el) => {
        await Promise.all(
          el
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
    await captureRetina("context-details.png");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__referenceFixture.setContextDetails(false));
    assert.equal(geometry.surface.background, "rgb(31, 31, 36)");
    assert.equal(geometry.panel.background, "rgb(51, 51, 56)");
    assert.ok(Math.abs(geometry.panel.width - 1512 * 0.2) < 1);
    assert.equal(geometry.panel.radius, "16px");
    assert.equal(geometry.panel.border, "0px");
    assert.equal(geometry.panel.shadow, "none");
    assert.equal(geometry.bubble.background, "rgb(126, 68, 38)");
    assert.equal(geometry.bubble.radius, "14px");
    assert.equal(geometry.bubble.padding, "8px 12px");
    assert.ok(geometry.bubble.width <= geometry.column.width * 0.52 + 1);
    assert.equal(geometry.answer.weight, "400");
    assert.equal(parseFloat(geometry.answer.lineHeight), parseFloat(geometry.answer.font) * 1.5);
    assert.equal(geometry.composer.background, "rgb(60, 60, 64)");
    assert.equal(geometry.composer.radius, "20px");
    assert.equal(geometry.composer.border, "0px");
    assert.ok(Math.abs(geometry.send.width - 32) < 0.01);
    assert.ok(Math.abs(geometry.send.height - 32) < 0.01);
    assert.equal(geometry.placeholder.font, "14px");
    assert.ok(geometry.permission.width > 0);
    assert.ok(geometry.composer.width < geometry.column.width);
    assert.equal(geometry.answer.width, geometry.composer.width);
    assert.equal(geometry.answer.x, geometry.composer.x);
    assert.ok(geometry.model.x < geometry.permission.x && geometry.permission.x < geometry.send.x);
    assert.ok(geometry.permission.x < geometry.capacity.x && geometry.capacity.x < geometry.send.x);
    assert.ok(
      Math.abs(geometry.capacity.y + geometry.capacity.height / 2 - geometry.send.y - 16) < 3,
    );
    assert.equal(geometry.source.height, 30);
    assert.equal(await fixture.locator("[data-conversation-turn-navigator]").count(), 0);
    await work.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#reference-conversation-fixture .conversation-work-summary button")
          ?.getAttribute("aria-expanded") === "true",
    );
    await fixture.locator(".conversation-work-log").first().waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document
        .querySelector("#reference-conversation-fixture")
        ?.getAnimations({ subtree: true })
        .every((animation) => animation.playState !== "running"),
    );
    assert.ok((await fixture.locator(".conversation-work-log").count()) > 0);
    await captureRetina("work-expanded.png");
    await page.evaluate(() => window.__referenceFixture.addGuide());
    assert.equal(await work.count(), 1);
    assert.equal(await work.getAttribute("aria-expanded"), "true");
    await fixture.getByText("继续核对", { exact: true }).waitFor();
    await work.click();
    await page.evaluate(() => window.__referenceFixture.render({ extra: true }));
    const link = fixture.locator(".conversation-website-link");
    await link.waitFor();
    assert.equal(await link.locator("svg").count(), 1);
    assert.doesNotMatch(await link.innerText(), /网站|打开/);
    await link.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await link.click();
    assert.equal(await page.evaluate(() => window.__referenceFixture.counts.browser), 1);
    await panel.getByRole("button", { name: "添加来源", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__referenceFixture.counts.add), 1);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    for (const theme of ["mycode-light", "mycode-dark"]) {
      await page.evaluate((theme) => window.__referenceFixture.applyTheme(theme), theme);
      for (const width of [390, 800]) {
        await page.setViewportSize({ width, height: 982 });
        assert.equal(await fixture.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        await page.screenshot({ path: join(destination, `${theme}-${width}.png`) });
      }
    }
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await page.evaluate(() => {
      window.__referenceFixture.cleanup();
      delete window.__referenceFixture;
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await verifySummaryToggle(page, output);
}
