import assert from "node:assert/strict";
import { join } from "node:path";

/** 使用实际 Renderer 验证计算机图标和生命周期文案；不修改会话数据。 */
export async function verifyReferenceComputerIcons(page, output) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1524,
    height: 528,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate(() => {
    window.__inventoryFixture.applyTheme("mycode-dark");
    document.documentElement.style.setProperty("--ui-font-size", "27px");
  });
  const root = page.locator("[data-reference-fixture]");
  const group = root.locator('[data-tool-layout-variant="operations"] > [data-process-row]');
  for (const locale of ["en-US", "zh-CN"]) {
    for (const status of ["success", "running"]) {
      await page.evaluate(
        ({ locale, status }) => {
          const f = window.__referenceFixture;
          const original = f.rows[0];
          f.rows.splice(0, f.rows.length, {
            ...original,
            rowId: 920,
            toolCallId: "computer",
            toolName: "mcp__cua__press_key",
            status,
            input: {},
            display: { kind: "mcp_tool", serverName: "cua_driver", toolName: "press_key" },
            output: { text: "Original computer result." },
          });
          f.render(locale);
        },
        { locale, status },
      );
      await group.waitFor();
      await page.waitForFunction(() =>
        document.querySelector(
          '[data-tool-layout-variant="operations"] [data-process-icon] .tabler-icon-pointer-2',
        ),
      );
      assert.equal(
        await group.innerText(),
        locale === "zh-CN"
          ? status === "success"
            ? "已使用计算机操作"
            : "使用计算机操作"
          : status === "success"
            ? "Used computer"
            : "Using computer",
      );
      const computerRow = root.locator('[data-row-id="920"] [data-process-row]').first();
      await computerRow.waitFor();
      assert.match(
        await computerRow.locator("[data-process-icon] svg").getAttribute("class"),
        /pointer-2/,
      );
      await page.waitForTimeout(350);
      await page.screenshot({
        scale: "css",
        path: join(output, "computer-" + locale + "-" + status + ".png"),
      });
    }
  }
}
