import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountConversationFixture } from "./mycode-conversation-fixture.mjs";

export async function verifyConversationPresentation(page, output) {
  const filePath = join(output, "pelican-bicycle-v2.html");
  await writeFile(filePath, "<!doctype html><title>Animation fixture</title><p>Preview</p>");
  await mountConversationFixture(page, filePath);
  const fixture = page.locator("#conversation-presentation-fixture");
  const complete = fixture.locator('[data-fixture-turn="complete"]');
  const live = fixture.locator('[data-fixture-turn="live"]');
  try {
    const switchMarker = fixture.locator('[data-row-id="201"]');
    await switchMarker.waitFor();
    assert.equal(await switchMarker.innerText(), "deepseek-flash 模型已切换 Qwen3.8-27B");
    assert.equal(await switchMarker.locator("svg.lucide-circle-alert").count(), 1);
    assert.equal(await switchMarker.locator("svg.lucide-arrow-right-left").count(), 0);
    assert.equal((await switchMarker.locator("svg").boundingBox()).width, 14);
    const firstUse = fixture.locator('[data-row-id="202"]');
    assert.equal(await firstUse.innerText(), "正在使用 Qwen3.8-27B");
    assert.equal(await firstUse.locator("svg").count(), 0);
    for (const scenario of [
      {
        fromProvider: "llama",
        fromModel: "Qwen3.8-27B",
        toProvider: "deepseek",
        toModel: "deepseek-pro",
        expected: "Qwen3.8-27B 模型已切换 deepseek-pro",
      },
      {
        fromProvider: "custom-a",
        fromModel: "model-one",
        toProvider: "custom-b",
        toModel: "model-two",
        expected: "model-one 模型已切换 model-two",
      },
    ]) {
      await page.evaluate(
        ({ expected: _expected, ...marker }) =>
          window.__conversationFixture.render({
            modelChange: { type: "modelChange", toThought: "high", ...marker },
          }),
        scenario,
      );
      await switchMarker.getByText(scenario.expected, { exact: true }).waitFor();
      assert.equal(await switchMarker.locator("svg.lucide-circle-alert").count(), 1);
    }
    await page.evaluate(() =>
      window.__conversationFixture.render({
        modelChange: window.__conversationFixture.initialModelChange,
      }),
    );
    await complete.locator("[data-v4-user-input-bubble]").waitFor();
    const history = complete.locator("button[data-history-open]").first();
    if ((await history.getAttribute("data-history-open")) === "false") await history.click();
    await complete.locator("[data-conversation-work-items]").first().waitFor();
    const read = complete.getByTestId("tool-summary-trigger-fixture-read");
    await read.waitFor();
    const readIcon = read.locator("svg.lucide-book-open").first();
    assert.equal(await readIcon.count(), 1);
    assert.equal((await readIcon.boundingBox()).width, 14);
    assert.equal(await readIcon.getAttribute("stroke-width"), "1.5");
    await read.getByRole("button", { name: "pelican-bicycle.html", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__conversationFixture.counters.preview), 1);
    const write = complete.getByTestId("tool-summary-trigger-fixture-write");
    assert.equal(await write.evaluate((el) => getComputedStyle(el).fontSize), "12px");
    assert.equal((await write.locator("svg.lucide-write").boundingBox()).width, 14);
    assert.equal(
      await write.locator("svg.lucide-write").evaluate((el) => getComputedStyle(el).strokeWidth),
      "2px",
    );
    await write.getByText("执行失败", { exact: true }).hover();
    await page.getByRole("tooltip").filter({ hasText: "测试中的文件不可写" }).waitFor();
    await fixture.locator("main").hover({ position: { x: 2, y: 2 } });
    await live.getByTestId("chat-loading").waitFor();
    assert.equal(
      await live
        .getByTestId("chat-loading")
        .locator("svg")
        .evaluate((el) => getComputedStyle(el).width),
      "12px",
    );
    const liveReasoning = live.getByTestId("chat-reasoning-trigger");
    assert.equal(await liveReasoning.evaluate((el) => getComputedStyle(el).fontSize), "12px");
    assert.equal((await liveReasoning.locator("svg.lucide-brain").boundingBox()).width, 14);
    await liveReasoning.click();
    await live
      .getByTestId("chat-reasoning-content")
      .getByText(/ground contact/)
      .waitFor();
    await liveReasoning.click();

    for (const theme of ["mycode-dark", "mycode-light"]) {
      await page.evaluate((value) => {
        window.__conversationFixture.applyTheme(value);
        window.__conversationFixture.render({ theme: value });
      }, theme);
      for (const width of [390, 800, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        const geometry = await complete.evaluate((el) => {
          const bubble = el.querySelector("[data-v4-user-input-bubble]");
          const row = bubble.parentElement;
          const answer = [...el.querySelectorAll(".conversation-answer")].at(-1);
          const work = el.querySelector("[data-conversation-work-items]");
          return {
            bubble: bubble.getBoundingClientRect().width,
            host: row.getBoundingClientRect().width,
            font: getComputedStyle(bubble).fontSize,
            padding: getComputedStyle(bubble).padding,
            answer: answer.getBoundingClientRect().width,
            answerFont: getComputedStyle(answer).fontSize,
            line: getComputedStyle(answer).lineHeight,
            gap: getComputedStyle(work).gap,
            overflow: el.scrollWidth > el.clientWidth,
            alignment: getComputedStyle(answer.querySelector("p")).textAlign,
            inlineOverflow: [...answer.querySelectorAll("p code")].some((code) => {
              const range = document.createRange();
              range.selectNodeContents(code);
              const bounds = answer.getBoundingClientRect();
              return [...range.getClientRects(), ...code.getClientRects()].some(
                (rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1,
              );
            }),
          };
        });
        assert.ok(
          geometry.bubble <= 448.1 && geometry.bubble <= geometry.host * 0.85 + 0.1,
          JSON.stringify(geometry),
        );
        assert.equal(geometry.font, "13px");
        assert.equal(geometry.padding, "10px 16px");
        assert.equal(geometry.answerFont, "13px");
        assert.equal(geometry.line, "22px");
        assert.ok(geometry.answer <= 976);
        assert.equal(geometry.gap, "8px");
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.alignment, "justify");
        assert.equal(geometry.inlineOverflow, false);
        assert.equal(await read.evaluate((el) => getComputedStyle(el).fontSize), "12px");
        assert.equal(await history.evaluate((el) => getComputedStyle(el).fontSize), "12px");
        const card = complete.locator("[data-assistant-preview-card]");
        const summary = complete.locator("[data-conversation-file-summary]");
        await card.waitFor();
        const bodyBox = await complete.locator(".conversation-answer").last().boundingBox();
        for (const target of [card, summary]) {
          const box = await target.boundingBox();
          assert.ok(
            Math.abs(box.x - bodyBox.x) < 1 && Math.abs(box.width - bodyBox.width) < 1,
            JSON.stringify({ bodyBox, box }),
          );
        }
        assert.equal((await card.locator("svg.lucide-globe").boundingBox()).width, 18);
        assert.equal(
          (await card.getByRole("button", { name: "打开", exact: true }).boundingBox()).height,
          24,
        );
        assert.equal((await summary.boundingBox()).height, 34);
        await page.screenshot({ path: join(output, `conversation-compact-${width}-${theme}.png`) });
      }
    }
    await page.evaluate(() => window.__conversationFixture.render({ question: "简短提问" }));
    const bubble = complete.locator("[data-v4-user-input-bubble]");
    await bubble.getByText("简短提问", { exact: true }).waitFor();
    assert.ok((await bubble.boundingBox()).width < 120);
    await bubble.hover();
    await bubble.locator("..").getByRole("button", { name: "复制", exact: true }).click();
    await page.waitForFunction(() => window.__conversationFixture.counters.copied === "简短提问");
    await page.evaluate(() =>
      window.__conversationFixture.render({
        question: "长提问内容，需要保留完整文字并且允许展开。".repeat(90),
      }),
    );
    const expand = bubble.getByRole("button", { name: "展开", exact: true });
    await expand.waitFor();
    await expand.click();
    await bubble.getByRole("button", { name: "收起", exact: true }).waitFor();
    assert.ok((await bubble.boundingBox()).height > 140);
    await bubble.getByRole("button", { name: "收起", exact: true }).click();
    await complete.hover();
    await complete.getByTestId("v4-edit-2").click();
    await complete.getByTestId("v4-edit-input-2").waitFor();
    await complete.getByTestId("v4-edit-cancel-2").click();
    await bubble.waitFor();
    const card = complete.locator("[data-assistant-preview-card]");
    await card.getByRole("button", { name: "打开", exact: true }).click();
    await page.waitForFunction(() => window.__conversationFixture.counters.browser === 1);
    const summary = complete.locator("[data-conversation-file-summary]");
    await summary.getByRole("button", { name: "展开已更改文件" }).click();
    await summary.getByRole("button", { name: "审查", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__conversationFixture.counters.preview), 2);
    await summary.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForFunction(() => window.__conversationFixture.counters.rewind === 1);
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.__conversationFixture.render({ groupReads: true, question: "简短提问" }),
    );
    await complete.locator("svg.lucide-book-open").first().waitFor();
    assert.equal(await complete.getByTestId("tool-summary-trigger-fixture-read").count(), 0);
    await page.evaluate(() =>
      window.__conversationFixture.render({
        timeline: true,
        question: window.__conversationFixture.initialQuestion,
      }),
    );
    for (const panel of ["none", "inline"]) {
      await page.evaluate((panel) => window.__conversationFixture.render({ panel }), panel);
      for (const width of [390, 800, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(async () => {
          const root = document.getElementById("conversation-presentation-fixture");
          root.getBoundingClientRect();
          await new Promise(requestAnimationFrame);
          await Promise.all(
            root
              .getAnimations({ subtree: true })
              .filter((animation) => animation.constructor.name === "CSSTransition")
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        const body = fixture.locator(".conversation-answer").last();
        await body.waitFor();
        await fixture.locator("[data-assistant-preview-card]").waitFor();
        const bodyBox = await body.boundingBox();
        if (width === 1440 && panel === "none") {
          assert.ok(bodyBox.width >= 900, JSON.stringify(bodyBox));
          assert.ok(
            Math.abs(bodyBox.x + bodyBox.width / 2 - width / 2) <= 9,
            JSON.stringify(bodyBox),
          );
        }
        for (const target of [
          fixture.locator("[data-fixture-composer]"),
          fixture.locator("[data-assistant-preview-card]"),
          fixture.locator("[data-conversation-file-summary]"),
        ]) {
          const box = await target.boundingBox();
          assert.ok(
            Math.abs(box.x - bodyBox.x) < 1 && Math.abs(box.width - bodyBox.width) < 1,
            JSON.stringify({ width, panel, bodyBox, box }),
          );
        }
        await page.screenshot({
          path: join(output, `conversation-alignment-${width}-${panel}.png`),
        });
      }
    }
  } catch (error) {
    await page.screenshot({ path: join(output, "conversation-fixture-failure.png") });
    throw error;
  } finally {
    await page.evaluate(() => {
      navigator.clipboard.writeText = window.__conversationFixture.originalClipboardWrite;
      window.__conversationFixture.applyTheme("mycode-dark");
      window.__conversationFixture.root.unmount();
      window.__conversationFixture.host.remove();
      delete window.__conversationFixture;
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
