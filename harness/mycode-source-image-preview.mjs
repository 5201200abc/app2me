import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySourceImagePreview(page, source, output, name) {
  const target = source.locator("[data-source-kind='screenshot'] button").first();
  await target.click();
  const preview = page.getByTestId("conversation-source-image-preview");
  await preview.waitFor();
  const image = preview.getByTestId("conversation-source-preview-image");
  await image.waitFor();
  await image.evaluate((el) => el.decode());
  await preview.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
  assert.equal(await preview.locator("img").count(), 1);
  assert.equal(await preview.locator("[data-row-id]").count(), 0);
  assert.equal(await preview.getByText("测试", { exact: true }).count(), 0);
  assert.equal(await preview.getByRole("button", { name: /复制|定位/ }).count(), 0);
  const geometry = await image.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      width: el.naturalWidth,
      height: el.naturalHeight,
      visible: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      centered: Math.abs(r.x + r.width / 2 - innerWidth / 2) < 2,
      ratio: el.clientWidth / el.clientHeight,
    };
  });
  assert.equal(geometry.width, 800);
  assert.equal(geometry.height, 400);
  const request = await page.evaluate(() => window.__inventoryFixture.latestPreviewRead);
  assert.deepEqual(request, {
    sessionId: name === "mobile-sources" ? "empty" : "inventory",
    ref: "/var/folders/fixture/T/codex-clipboard-82a4f593-c212-4d13-a394-0cdbb56035ce.png",
  });
  assert.equal(geometry.visible, true);
  assert.equal(geometry.centered, true);
  assert.ok(Math.abs(geometry.ratio - 2) < 0.01);
  const src = await image.getAttribute("src");
  await page.screenshot({ path: join(output, `source-image-${name}.png`) });
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    }, src),
    false,
  );
}

export async function verifySourceImageFailure(page, inventory) {
  await page.evaluate(() => {
    window.__inventoryFixture.previewReadOverride = () => Promise.reject(new Error("missing"));
  });
  await inventory.locator("[data-source-kind='screenshot'] button").first().click();
  const preview = page.getByTestId("conversation-source-image-preview");
  await preview.getByRole("status").getByText("这张图片已无法预览。", { exact: true }).waitFor();
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.previewReadOverride = ({ signal }) =>
      new Promise((resolve) => {
        f.previewSignal = signal;
        f.finishPreview = () =>
          resolve({
            bytes: Uint8Array.from(atob(f.png), (c) => c.charCodeAt(0)),
            mediaType: "image/png",
          });
      });
  });
  await inventory.locator("[data-source-kind='screenshot'] button").first().click();
  await preview.getByRole("status").getByText("正在加载图片预览…", { exact: true }).waitFor();
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__inventoryFixture.previewSignal.aborted), true);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.finishPreview();
    f.previewReadOverride = undefined;
  });
  assert.equal(await preview.count(), 0);
}
