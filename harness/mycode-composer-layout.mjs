import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Runs against the real Electron renderer; viewport emulation does not test OS window sizing.
export async function verifyComposerLayout(page, output) {
  const results = [];
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="v4-composer-send"]');
      return node && node.getBoundingClientRect().width > 0;
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const geometry = await page.getByTestId("v4-composer").evaluate((node) => {
      const rect = (element) => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const send = node.querySelector('[data-testid="v4-composer-send"]');
      const controls = node.querySelector('[data-testid="composer-model-controls"]');
      const thought = node.querySelector("[data-composer-thought-control]");
      return {
        viewport: window.innerWidth,
        composer: rect(node),
        send: { ...rect(send), radius: getComputedStyle(send).borderRadius },
        controls: {
          ...rect(controls),
          border: getComputedStyle(controls).borderWidth,
          background: getComputedStyle(controls).backgroundColor,
        },
        thought: thought
          ? { ...rect(thought), compact: thought.hasAttribute("data-composer-compact") }
          : null,
        buttons: [...node.querySelectorAll("button")]
          .filter(
            (button) =>
              button.getClientRects().length && getComputedStyle(button).visibility !== "hidden",
          )
          .map((button) => ({
            ...rect(button),
            label: button.getAttribute("aria-label") || button.textContent,
          })),
      };
    });
    assert.equal(geometry.viewport, width);
    assert.ok(geometry.composer.x >= -1 && geometry.composer.right <= width + 1);
    assert.equal(geometry.send.width, geometry.send.height);
    assert.ok(
      geometry.send.radius === "50%" || parseFloat(geometry.send.radius) >= geometry.send.width / 2,
    );
    assert.equal(geometry.controls.border, "0px");
    assert.equal(geometry.controls.background, "rgba(0, 0, 0, 0)");
    for (const button of geometry.buttons) {
      assert.ok(
        button.x >= -1 && button.right <= width + 1,
        `button outside viewport: ${button.label}`,
      );
    }
    results.push(geometry);
    await page.screenshot({ path: join(output, `composer-${width}.png`) });
  }
  await writeFile(
    join(output, "composer-layout.json"),
    JSON.stringify({ passed: true, results }, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  return results;
}
