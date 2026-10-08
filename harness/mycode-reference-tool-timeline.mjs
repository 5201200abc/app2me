import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { verifyReferenceComputerIcons } from "./mycode-reference-computer-icons.mjs";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyReferenceToolTimeline(page, output) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1524,
    height: 528,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationRowView } = await f.load("v4/ConversationRowView.tsx");
    const { ConversationOperationGroup } = await f.load("v4/ConversationOperationGroup.tsx");
    const { MyCodeIntlProvider } = await f.load("i18n/IntlProvider.tsx");
    const style = document.createElement("style");
    style.dataset.referenceFixtureStyle = "";
    style.textContent =
      "#inventory-tool-fixture main{padding:0} #inventory-tool-fixture [data-tool-fixture-column]{max-width:none} #inventory-tool-fixture [data-turn-key],#inventory-tool-fixture [data-testid=chat-summary-panel]{display:none} [data-reference-fixture]{padding:14px} [data-reference-fixture] [data-conversation-work-items]{display:flex;flex-direction:column}";
    document.head.append(style);
    const context = {
      workspacePath: "/fixture/default",
      sessionId: "reference",
      logEpoch: "1",
      messageStreamShowReasoning: true,
      onOpenCodeViewer() {
        f.counters.preview++;
      },
    };
    const base = (id) => ({ rowId: id, turnId: "reference", createdAt: 1, createdAtSeq: id });
    const tool = (id, toolName, input, text = "Original output.") => ({
      ...base(id),
      kind: "toolCall",
      toolCallId: "reference-" + id,
      toolName,
      inputText: "",
      status: "success",
      input,
      output: { text },
    });
    const command =
      "set -o pipefail; node --import tsx harness/mycode-process-typography.e2e.mjs 2>&1 | condense 'PASS or FAIL? List failing items with their relevant raw error messages.'";
    const rows = [
      tool(901, "Read", { file_path: "/fixture/default/process-row.css" }),
      tool(902, "Bash", {
        command: "rtk rg -n 'animated-gradient-text' packages/ui/src --glob '*.css' -m 10",
      }),
      tool(903, "Edit", {
        file_path: "/fixture/default/mycode-process-typography.mjs",
        old_string: "before 1\nbefore 2",
        new_string: "after 1\nafter 2",
      }),
      tool(
        904,
        "Bash",
        { command },
        "node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n" +
          "Original output line\n".repeat(30),
      ),
      tool(
        905,
        "Skill",
        {
          skill: "browser-use:control-browser",
          args: "Open http://127.0.0.1:8731/pelican-cycling.html and take a full screenshot of the rendered SVG scene.",
        },
        '<skill_content name="control-browser">\n# Skill: control-browser\n# Browser automation\n' +
          "Original skill line\n".repeat(30),
      ),
      { ...base(906), kind: "reasoning", state: "complete", text: "Original reasoning content." },
    ];
    window.__referenceFixture = {
      command,
      rows,
      context,
      counters: f.counters,
      render(locale = "en-US", includeBody = false) {
        f.render({
          empty: true,
          extra: f.h(
            MyCodeIntlProvider,
            { initialLocale: locale, key: locale },
            f.h(
              "div",
              {
                "data-reference-fixture": "",
                className: "conversation-reference-surface conversation-work-log",
              },
              f.h(
                "div",
                { "data-conversation-work-items": "" },
                ...(includeBody
                  ? [
                      f.h(ConversationRowView, {
                        key: "body",
                        row: {
                          ...base(900),
                          kind: "assistantText",
                          state: "complete",
                          text: "Now I'll render it in a browser to verify the artwork and animation.",
                        },
                        context,
                      }),
                    ]
                  : []),
                f.h(ConversationOperationGroup, {
                  groupId: "reference-group-" + locale,
                  rows: rows.filter((row) => row.kind === "toolCall"),
                  context,
                  renderContent: () =>
                    f.h(
                      "div",
                      { "data-conversation-work-items": "" },
                      ...rows.map((row) =>
                        f.h(ConversationRowView, { key: row.rowId, row, context }),
                      ),
                    ),
                }),
              ),
            ),
          ),
        });
      },
    };
    window.__referenceFixture.render();
    f.applyTheme("mycode-dark");
    document.documentElement.style.setProperty("--ui-font-size", "27px");
  });
  const root = page.locator("[data-reference-fixture]");
  const group = root.locator('[data-tool-layout-variant="operations"] > [data-process-row]');
  await group.waitFor();
  await group.click();
  const row = (id) => root.locator('[data-row-id="' + id + '"] [data-process-row]').first();
  await row(904).waitFor();
  await row(904).click();
  await root.locator("[data-command-scroll]").waitFor();
  await page.waitForTimeout(350);
  const metrics = await root.evaluate((el) => {
    const rows = [...el.querySelectorAll("[data-process-row]")];
    return rows.map((row) => {
      const r = row.getBoundingClientRect(),
        s = getComputedStyle(row),
        icon = row.querySelector("[data-process-icon] svg");
      const copy = row.querySelector("[data-process-copy]"),
        arrow = row.querySelector("[data-process-chevron]");
      const i = icon.getBoundingClientRect();
      return {
        text: row.textContent,
        height: r.height,
        x: i.x,
        iconY: i.y + i.height / 2,
        rowY: r.y + r.height / 2,
        iconWidth: i.width,
        iconHeight: i.height,
        iconClass: icon.classList.value,
        stroke: getComputedStyle(icon).strokeWidth,
        gap: s.columnGap,
        font: s.fontSize,
        weight: s.fontWeight,
        copyX: copy.getBoundingClientRect().x,
        arrow: arrow?.classList.value,
        arrowTransform: arrow ? getComputedStyle(arrow).rotate : null,
        arrowX: arrow?.getBoundingClientRect().x,
        arrowRight: arrow?.getBoundingClientRect().right,
        rowRight: r.right,
      };
    });
  });
  assert.equal(metrics.length, 7);
  for (const m of metrics) {
    assert.equal(m.height, 52);
    assert.equal(m.font, "26px");
    assert.equal(m.weight, "400");
    assert.equal(m.iconWidth, 26);
    assert.equal(m.iconHeight, 26);
    assert.equal(m.stroke, "1.5px");
    assert.ok(Math.abs(Number.parseFloat(m.gap) - 16.9) < 0.1);
    assert.ok(Math.abs(m.x - metrics[0].x) < 0.1);
    assert.ok(Math.abs(m.iconY - m.rowY) < 0.1);
    assert.ok(m.arrow.includes("chevron-right"));
    if (m.text.startsWith("Ran")) assert.ok(Math.abs(m.arrowRight - m.rowRight) < 0.2);
  }
  assert.match(metrics[0].iconClass, /tool/);
  assert.match(metrics[1].iconClass, /book/);
  assert.match(metrics[2].iconClass, /terminal-2/);
  assert.match(metrics[3].iconClass, /pencil/);
  assert.match(metrics[5].iconClass, /terminal-2/);
  assert.match(metrics[6].iconClass, /bulb/);
  assert.ok(metrics[0].arrowX < metrics[0].rowRight - 200);
  assert.equal(metrics[0].arrowTransform, "90deg");
  const card = row(904).locator("..").locator(".tool-detail-scroll");
  const cardMetrics = await card.evaluate((el) => {
    const s = getComputedStyle(el),
      scroll = el.querySelector("[data-command-scroll]"),
      pre = el.querySelector("[data-command-line] pre");
    const shell = el.querySelector("[data-command-title]"),
      line = el.querySelector("[data-command-line]"),
      output = el.querySelector("[data-testid=bash-result-output]");
    return {
      radius: s.borderRadius,
      border: s.borderWidth,
      padding: s.padding,
      width: el.getBoundingClientRect().width,
      parentWidth: el.closest(".tool-call-layout").getBoundingClientRect().width,
      bg: s.backgroundColor,
      parentBg: getComputedStyle(document.getElementById("inventory-tool-fixture")).backgroundColor,
      font: getComputedStyle(pre).fontSize,
      line: getComputedStyle(pre).lineHeight,
      mono: getComputedStyle(pre).fontFamily,
      wrap: getComputedStyle(pre).whiteSpace,
      overflow: getComputedStyle(pre).overflowWrap,
      commandLeft: line.getBoundingClientRect().x,
      titleLeft: shell.getBoundingClientRect().x,
      outputLeft: output.getBoundingClientRect().x,
      gap1: line.getBoundingClientRect().y - shell.getBoundingClientRect().bottom,
      gap2: output.getBoundingClientRect().y - line.getBoundingClientRect().bottom,
      scrollHeight: scroll.clientHeight,
      overflowY: getComputedStyle(scroll).overflowY,
      outerOverflow: s.overflowY,
      scrollbar: getComputedStyle(scroll).scrollbarWidth,
    };
  });
  assert.equal(cardMetrics.radius, "16px");
  assert.equal(cardMetrics.border, "1px");
  assert.equal(cardMetrics.padding, "16px");
  assert.equal(cardMetrics.width, cardMetrics.parentWidth);
  assert.notEqual(cardMetrics.bg, cardMetrics.parentBg);
  assert.equal(cardMetrics.font, "26px");
  assert.equal(cardMetrics.line, "39px");
  assert.match(cardMetrics.mono, /mono/i);
  assert.equal(cardMetrics.wrap, "pre-wrap");
  assert.equal(cardMetrics.overflow, "anywhere");
  assert.equal(cardMetrics.commandLeft, cardMetrics.titleLeft);
  assert.equal(cardMetrics.outputLeft, cardMetrics.titleLeft);
  assert.equal(cardMetrics.gap1, 12);
  assert.equal(cardMetrics.gap2, 12);
  assert.ok(cardMetrics.scrollHeight <= 186);
  assert.equal(cardMetrics.overflowY, "auto");
  assert.equal(cardMetrics.outerOverflow, "visible");
  assert.equal(cardMetrics.scrollbar, "thin");
  assert.equal(
    await root.locator("[data-command-line] pre").innerText(),
    await page.evaluate(() => window.__referenceFixture.command),
  );
  await page.screenshot({ scale: "css", path: join(output, "reference-1524.png") });
  await root.locator("[data-command-copy]").click();
  assert.equal(
    await page.evaluate(() => window.__referenceFixture.counters.copied),
    await page.evaluate(() => window.__referenceFixture.command),
  );
  await row(903).locator("[data-file-name]").click();
  assert.equal(await page.evaluate(() => window.__referenceFixture.counters.preview), 1);
  const fileMetrics = await row(903).evaluate((el) => {
    const name = el.querySelector("[data-file-name]"),
      diff = el.querySelector("[data-tool-diff-count]");
    return {
      name: getComputedStyle(name).color,
      diff: getComputedStyle(diff).color,
      size: getComputedStyle(diff).fontSize,
      decoration: getComputedStyle(name).textDecorationLine,
      gap: diff.getBoundingClientRect().x - name.getBoundingClientRect().right,
    };
  });
  assert.equal(fileMetrics.name, fileMetrics.diff);
  assert.equal(fileMetrics.size, "26px");
  assert.equal(fileMetrics.decoration, "underline");
  assert.ok(fileMetrics.gap < 9);
  await row(904).click();
  await row(905).click();
  const skill = root.locator("[data-skill-content]");
  await skill.waitFor();
  await page.waitForTimeout(350);
  await skill.scrollIntoViewIfNeeded();
  assert.equal(await skill.locator("code").count(), 0);
  assert.equal(await skill.getByText("参数", { exact: true }).count(), 0);
  assert.match(await skill.innerText(), /browser-use:control-browser/);
  assert.match(await skill.innerText(), /Open http:\/\/127\.0\.0\.1:8731/);
  assert.match(await skill.innerText(), /Original skill line/);
  await page.screenshot({ scale: "css", path: join(output, "skill-1524.png") });
  await row(906).focus();
  await page.keyboard.press("Enter");
  await root.getByText("Original reasoning content.", { exact: true }).waitFor();
  for (const locale of ["en-US", "zh-CN"]) {
    await page.evaluate((locale) => window.__referenceFixture.render(locale, true), locale);
    await group.waitFor();
    if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
    await page.waitForTimeout(350);
    for (const theme of ["mycode-dark", "mycode-light"]) {
      await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
      for (const size of [14, 18]) {
        await page.evaluate(
          (size) => document.documentElement.style.setProperty("--ui-font-size", size + "px"),
          size,
        );
        assert.equal(
          await root
            .locator(".conversation-answer")
            .evaluate((el) => getComputedStyle(el).fontSize),
          size - 1 + "px",
        );
        const geometry = await root.locator("[data-process-row]").evaluateAll((elements) =>
          elements.map((el) => {
            const icon = el.querySelector("[data-process-icon] svg"),
              r = el.getBoundingClientRect();
            return {
              height: r.height,
              font: getComputedStyle(el).fontSize,
              icon: icon.getBoundingClientRect().width,
              x: icon.getBoundingClientRect().x,
            };
          }),
        );
        assert.ok(
          geometry.every(
            (m) =>
              m.height === (size - 1) * 2 &&
              m.font === size - 1 + "px" &&
              m.icon === size - 1 &&
              Math.abs(m.x - geometry[0].x) < 0.1,
          ),
        );
      }
      await page.screenshot({ scale: "css", path: join(output, locale + "-" + theme + ".png") });
    }
  }
  // 原 ExecuteOutput 的吸底、上滚冻结、回到底部恢复，仍由同一个滚动节点拥有。
  await page.evaluate(() => {
    const f = window.__referenceFixture;
    f.rows[3] = {
      ...f.rows[3],
      status: "running",
      output: { text: "Streaming original\n".repeat(60) },
    };
    f.render("en-US");
    document.documentElement.style.setProperty("--ui-font-size", "14px");
  });
  if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
  if ((await row(904).getAttribute("aria-expanded")) === "false") await row(904).click();
  const scroll = root.locator("[data-command-scroll]");
  await scroll.waitFor();
  await page.waitForTimeout(100);
  assert.equal(await scroll.getAttribute("data-following"), "true");
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await scroll.getAttribute("data-following"), "false");
  await page.evaluate(() => {
    const f = window.__referenceFixture;
    f.rows[3] = { ...f.rows[3], output: { text: "New output after freeze\n".repeat(80) } };
    f.render("en-US");
  });
  assert.ok(!(await scroll.innerText()).includes("New output after freeze"));
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await scroll.getAttribute("data-following"), "true");
  assert.match(await scroll.innerText(), /New output after freeze/);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(await root.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
  await page.screenshot({ scale: "css", path: join(output, "narrow-390.png") });
  await verifyReferenceComputerIcons(page, output);
  const png = await readFile(join(output, "reference-1524.png"));
  assert.equal(png.readUInt32BE(16), 1524);
  assert.equal(png.readUInt32BE(20), 528);
  return {
    passed: true,
    viewport: { width: 1524, height: 528, deviceScaleFactor: 1, imageWidth: 1524 },
    metrics,
    cardMetrics,
    fileMetrics,
  };
}
