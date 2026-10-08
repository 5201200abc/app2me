import { verifyReferenceToolTimeline } from "./mycode-reference-tool-timeline.mjs";
import { verifyInventoryChangeRow } from "./mycode-inventory-change-row.mjs";

// 当前参考规格替换原 24px/22px 缩进规格；沿用原验证入口，覆盖时间线和变更行。
export async function verifyProcessTypography(page, output) {
  const timeline = await verifyReferenceToolTimeline(page, output);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
    document.querySelector("[data-reference-fixture-style]")?.remove();
    document.documentElement.style.removeProperty("--ui-font-size");
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await page.setViewportSize({ width: 1100, height: 900 });
  const inventory = await verifyInventoryChangeRow(page, output);
  return { passed: true, timeline, inventory };
}
