import assert from "node:assert/strict";
import { verifyAppearanceDetails } from "./mycode-appearance-polish.mjs";
import { verifyConversationPresentation } from "./mycode-conversation-presentation.mjs";
import { verifySummaryToggle } from "./mycode-summary-toggle-fixture.mjs";

export async function verifySummaryZoomPolish(page, app, output) {
  const native = await app.browserWindow(page);
  const invokeAcceleratorEntry = async (key) => {
    // macOS 的 CDP 合成按键不经 NSMenu accelerator；验证实际绑定和其 Main 命令入口。
    const result = await app.evaluate(({ Menu }, key) => {
      const flatten = (menu) =>
        menu.items.flatMap((item) => [item, ...(item.submenu ? flatten(item.submenu) : [])]);
      const keyCode = key.split("+").at(-1);
      const item = flatten(Menu.getApplicationMenu()).find(
        (item) => item.accelerator?.split("+").at(-1) === keyCode,
      );
      if (!item) return { found: false };
      item.click();
      return { found: true, accelerator: item.accelerator };
    }, key);
    assert.equal(result.found, true, JSON.stringify(result));
  };
  const level = () => page.evaluate(() => window.mycode.getDesktopZoomLevel());
  const waitLevel = async (expected) => {
    await page.waitForFunction(
      async (expected) => (await window.mycode.getDesktopZoomLevel()).zoomLevel === expected,
      expected,
    );
    const factor = await native.evaluate((win) => win.webContents.getZoomFactor());
    assert.ok(
      Math.abs(factor - Math.pow(1.1, expected)) < 0.00001,
      JSON.stringify({
        expected,
        factor,
        state: await level(),
      }),
    );
  };
  const openZoom = async () => {
    await page
      .locator(".workspace-sidebar-footer")
      .getByRole("button", { name: "MyCode", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "界面缩放", exact: true }).press("ArrowRight");
    await page.getByRole("menuitem", { name: /^放大/ }).waitFor();
  };
  const menuZoom = async (name, expected) => {
    await openZoom();
    await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
    await waitLevel(expected);
  };
  const disabled = async (name) => {
    await openZoom();
    assert.equal(
      await page
        .getByRole("menuitem", { name: new RegExp(`^${name}`) })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  };
  await waitLevel(0);
  await disabled("实际大小");
  await menuZoom("放大", 1);
  await menuZoom("放大", 2);
  await disabled("放大");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await invokeAcceleratorEntry(`${modifier}+=`);
  assert.equal((await level()).zoomLevel, 2);
  await menuZoom("实际大小", 0);
  await menuZoom("缩小", -1);
  await menuZoom("缩小", -2);
  await disabled("缩小");
  await invokeAcceleratorEntry(`${modifier}+-`);
  assert.equal((await level()).zoomLevel, -2);
  await invokeAcceleratorEntry(`${modifier}+0`);
  await waitLevel(0);
  await invokeAcceleratorEntry(`${modifier}+=`);
  await waitLevel(1);
  await invokeAcceleratorEntry(`${modifier}+=`);
  await waitLevel(2);
  await invokeAcceleratorEntry(`${modifier}+0`);
  await waitLevel(0);
  await invokeAcceleratorEntry(`${modifier}+-`);
  await waitLevel(-1);
  await invokeAcceleratorEntry(`${modifier}+-`);
  await waitLevel(-2);
  await invokeAcceleratorEntry(`${modifier}+0`);
  await waitLevel(0);
  await page.keyboard.press(`${modifier}+,`);
  const settings = page.getByTestId("settings-page");
  await settings.waitFor();
  await settings.getByTestId("settings-section-nav-appearance").click();
  await verifyAppearanceDetails(page, output);
  await verifySummaryToggle(page, output);
  await verifyConversationPresentation(page, output);
}
