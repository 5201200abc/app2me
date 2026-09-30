import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const output = resolve(".artifacts/mycode-startup");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: output, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.route("**/src/main.tsx*", (route) => route.abort());
  await page.goto(process.env.MYCODE_SMOKE_URL || "http://localhost:5173");
  await page.waitForFunction(() => {
    const img = document.querySelector(".mycode-startup__emblem img");
    return img?.complete && img.naturalWidth > 0 && document.getAnimations().length >= 7;
  });
  const sample = () =>
    page.locator(".mycode-startup__emblem").evaluate((node) => ({
      transform: getComputedStyle(node).transform,
      shimmerOpacity: getComputedStyle(node, "::after").opacity,
      bounds: node.getBoundingClientRect().toJSON(),
    }));
  const before = await sample();
  await page.waitForTimeout(1400);
  const after = await sample();
  assert.deepEqual(before.bounds, after.bounds, "the emblem must remain fixed");
  assert.equal(after.transform, "none");
  assert.notEqual(
    before.shimmerOpacity,
    after.shimmerOpacity,
    "the light effect must change over time",
  );
  const bounds = await page.locator(".mycode-startup__emblem").boundingBox();
  await page.screenshot({ path: resolve(output, "compact-preview.png") });
  await page.waitForTimeout(4700);
  await writeFile(
    resolve(output, "motion-evidence.json"),
    JSON.stringify({ before, after, fixed: true, animatedLight: true, bounds }, null, 2),
  );
  await context.close();
  await rename(await video.path(), resolve(output, "preview.webm"));
  console.log(
    JSON.stringify({
      fixed: true,
      animatedLight: true,
      width: bounds.width,
      video: resolve(output, "preview.webm"),
    }),
  );
} finally {
  await browser.close();
}
