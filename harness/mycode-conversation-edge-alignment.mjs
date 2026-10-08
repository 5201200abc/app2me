import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountConversationFixture } from "./mycode-conversation-fixture.mjs";

export async function verifyConversationEdgeAlignment(page, output) {
  const path = join(output, "alignment-fixture.html");
  await writeFile(path, "<!doctype html><title>Alignment</title>");
  await mountConversationFixture(page, path);
  const fixture = page.locator("#conversation-presentation-fixture");
  const measurements = [];
  try {
    await fixture.evaluate((el) => el.classList.add("conversation-reference-surface"));
    for (const theme of ["mycode-dark", "mycode-light"]) {
      for (const live of [false, true]) {
        await page.evaluate(
          ({ theme, live }) => {
            window.__conversationFixture.applyTheme(theme);
            window.__conversationFixture.render({ timeline: true, includeLiveTail: live, theme });
          },
          { theme, live },
        );
        for (const panel of ["none", "inline"]) {
          await page.evaluate((panel) => window.__conversationFixture.render({ panel }), panel);
          for (const width of [390, 800, 1440, 1920]) {
            await page.setViewportSize({ width, height: 1100 });
            await fixture.locator(".conversation-answer").last().waitFor();
            await fixture.evaluate(async (el) => {
              el.getBoundingClientRect();
              await new Promise(requestAnimationFrame);
              await Promise.all(
                el
                  .getAnimations({ subtree: true })
                  .filter((animation) => animation.constructor.name === "CSSTransition")
                  .map((animation) => animation.finished.catch(() => {})),
              );
            });
            const composer = await fixture.locator("[data-fixture-composer]").boundingBox();
            const edgeAligned = (box) =>
              Math.abs(box.x - composer.x) < 1 && Math.abs(box.width - composer.width) < 1;
            const answers = await fixture.locator(".conversation-answer").all();
            assert.ok(answers.length > 0);
            if (live)
              await fixture.locator("[data-v4-running-live-tail] .conversation-answer").waitFor();
            for (const answer of answers) {
              const box = await answer.boundingBox();
              assert.ok(
                edgeAligned(box),
                JSON.stringify({ theme, panel, width, composer, answer: box }),
              );
            }
            for (const paragraph of await fixture.locator(".conversation-answer > p").all()) {
              const style = await paragraph.evaluate((el) => {
                const css = getComputedStyle(el);
                return {
                  margin: parseFloat(css.marginBottom),
                  font: parseFloat(css.fontSize),
                  last: el === el.parentElement.lastElementChild,
                };
              });
              if (!style.last) assert.ok(style.margin <= style.font * 0.75 + 0.01);
            }
            for (const bubble of await fixture.locator("[data-v4-user-input-bubble]").all()) {
              const box = await bubble.boundingBox();
              assert.ok(
                Math.abs(box.x + box.width - composer.x - composer.width) < 1,
                JSON.stringify({ theme, panel, width, composer, bubble: box }),
              );
            }
            for (const action of await fixture.locator(".conversation-message-actions").all()) {
              const box = await action.boundingBox();
              assert.ok(Math.abs(box.x - composer.x) < 1);
            }
            assert.ok(composer.width <= 760);
            if (panel === "none")
              assert.ok(Math.abs(composer.x + composer.width / 2 - width / 2) < 9);
            measurements.push({ theme, panel, width, live, composer });
            await page.screenshot({
              path: join(
                output,
                `edge-alignment-${theme}-${width}-${panel}-${live ? "live" : "history"}.png`,
              ),
            });
          }
        }
      }
    }
    for (const question of ["你好", "请检查界面布局并保留现有行为。".repeat(25)]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.evaluate(
        (question) =>
          window.__conversationFixture.render({
            question,
            panel: "none",
            timeline: true,
            includeLiveTail: false,
          }),
        question,
      );
      const bubble = fixture.locator("[data-v4-user-input-bubble]").first();
      await bubble.waitFor();
      const box = await bubble.boundingBox();
      const text = await bubble.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(
        box.height - text.height <= 20,
        JSON.stringify({ question: question.length, box, text }),
      );
      if (question === "你好") assert.ok(box.width < 60 && box.height < 40);
      else assert.ok(box.height > 40);
    }
    await writeFile(join(output, "edge-alignment.json"), JSON.stringify(measurements, null, 2));
  } finally {
    await page.evaluate(() => {
      const fixture = window.__conversationFixture;
      navigator.clipboard.writeText = fixture.originalClipboardWrite;
      fixture.applyTheme("mycode-dark");
      fixture.root.unmount();
      fixture.host.remove();
      delete window.__conversationFixture;
    });
  }
}
