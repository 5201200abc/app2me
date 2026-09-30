import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const output = resolve(".artifacts/mycode-startup");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 3840, height: 2160 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.route("**/src/main.tsx*", (route) => route.abort());
    await page.goto(process.env.MYCODE_SMOKE_URL || "http://localhost:5173");
    await page.waitForFunction(() => {
      const img = document.querySelector(".mycode-startup__emblem img");
      return img?.complete && img.naturalWidth > 0;
    });
    const box = await page.locator(".mycode-startup").boundingBox();
    assert.deepEqual(box, { x: 0, y: 0, ...viewport });
    const emblemBox = await page.locator(".mycode-startup__emblem").boundingBox();
    assert.ok(
      emblemBox.width >= 143 && emblemBox.width <= 261,
      "the startup emblem remains compact",
    );
    const animations = await page.evaluate(() =>
      document.getAnimations().map((animation) => ({
        state: animation.playState,
        duration: animation.effect.getTiming().duration,
      })),
    );
    assert.ok(animations.length >= 7);
    assert.ok(animations.every((animation) => animation.state === "running"));
    const deltas = await page.evaluate(
      () =>
        new Promise((done) => {
          const frames = [];
          let previous;
          function frame(timestamp) {
            if (previous) frames.push(timestamp - previous);
            previous = timestamp;
            if (frames.length === 60) done(frames);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
    await page.screenshot({ path: resolve(output, `${viewport.width}.png`) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    results.push({
      viewport,
      box,
      emblemBox,
      animations,
      frames: deltas.length,
      medianFrameMs: deltas.slice().sort((a, b) => a - b)[30],
      maxFrameMs: Math.max(...deltas),
      reducedMotionPassed: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
