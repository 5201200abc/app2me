import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.MYCODE_SMOKE_URL || "http://localhost:5173";
const output = resolve(process.env.MYCODE_SMOKE_OUTPUT || ".artifacts/mycode-ui");
const theme = process.env.MYCODE_SMOKE_THEME || "mycode-dark";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, locale: "en-US" });
    await context.addInitScript((initialTheme) => {
      localStorage.setItem("mycode-locale", "en-US");
      localStorage.setItem("mycode-theme", initialTheme);
    }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.getByTestId("v4-composer").waitFor({ timeout: 90_000 });
    await page.waitForFunction((expectedTheme) => document.documentElement.classList.contains(`theme-${expectedTheme}`), theme);
    assert.match(await page.title(), /mycode/i);
    const send = page.getByTestId("v4-composer-send");
    const shape = await send.evaluate((node) => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, width: node.clientWidth, height: node.clientHeight };
    });
    assert.equal(
      shape.width,
      shape.height,
      "send control is square before applying its circular radius",
    );
    assert.ok(
      shape.radius === "50%" || parseFloat(shape.radius) >= shape.width / 2,
      "send control is circular",
    );
    assert.equal(await page.getByTestId("v4-draft-brand").count(), 1);
    const modelControls = await page.getByTestId("composer-model-controls").evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        border: style.borderWidth,
        radius: style.borderRadius,
      };
    });
    assert.equal(modelControls.background, "rgba(0, 0, 0, 0)");
    assert.equal(modelControls.border, "0px");
    await page.getByText("Select project", { exact: true }).waitFor();
    for (const target of [
      page.getByTestId("v4-composer"),
      send,
      page.getByTestId("v4-draft-brand"),
    ]) {
      const box = await target.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= viewport.width + 1,
        "primary content stays inside the viewport",
      );
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "the page fits the viewport");
    if (viewport.width > 1000) {
      await page.getByTestId("project-section").getByText("No projects", { exact: true }).waitFor();
      await page
        .getByTestId("conversation-section")
        .getByText("No chats", { exact: true })
        .waitFor();
      assert.match(await page.getByTestId("project-section").innerText(), /No projects/);
      assert.match(await page.getByTestId("conversation-section").innerText(), /No chats/);
      await page.getByText("Recents", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: /New chat/ })
        .first()
        .waitFor();
      for (const name of ["Group", "Project"]) {
        const button = page.getByRole("button", { name, exact: true });
        assert.equal(await button.locator("svg").count(), 0, `${name} has no leading icon`);
      }
    } else {
      const toggle = page.getByTestId("mobile-sidebar-toggle");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
      await page.getByTestId("project-section").getByText("No projects", { exact: true }).waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page
        .getByTestId("mobile-sidebar-backdrop")
        .click({ position: { x: viewport.width - 10, y: 200 } });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    }
    await page.screenshot({ path: resolve(output, `${viewport.width}.png`), fullPage: true });
    if (viewport.width > 1000) {
      const modifier = await page.evaluate(() =>
        /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
      );
      const toggle = page.getByTestId("mobile-sidebar-toggle");
      await page.keyboard.press(`${modifier}+b`);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await page.keyboard.press(`${modifier}+b`);
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page.keyboard.press(`${modifier}+,`);
      await page.getByTestId("settings-page").waitFor();
      const settingsNav = page.getByTestId("settings-page").locator("nav");
      assert.equal(await settingsNav.getByText(/Onboarding|引导/).count(), 0);
      for (const section of [
        "shortcuts",
        "memory",
        "subagents",
        "mcp",
        "skill",
        "commands",
        "hooks",
      ]) {
        await page.getByTestId(`settings-section-nav-${section}`).click();
        await page.getByTestId(`settings-section-nav-${section}`).waitFor();
      }
      await page.screenshot({ path: resolve(output, "settings.png"), fullPage: true });
      await page.getByTestId("settings-back-button").click();
      await page.keyboard.press(`${modifier}+k`);
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+m");
      await page.getByRole("menu").waitFor();
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, [], "no browser runtime errors");
    results.push({
      theme,
      viewport,
      shape,
      modelControls,
      checks:
        viewport.width > 1000
          ? [
              "empty projects and recents",
              "project selection",
              "group/project controls",
              "sidebar shortcut",
              "settings shortcut",
              "settings navigation",
              "command palette shortcut",
              "model picker shortcut",
            ]
          : ["viewport geometry", "mobile sidebar open and close"],
      errors,
      passed: true,
    });
    await context.close();
  }
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
