import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyReasoningAndTerminalSummaries(page, output) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationRowView } = await f.load("v4/ConversationRowView.tsx");
    const { ConversationShareReadonlyTimeline } = await f.load(
      "v4/ConversationShareReadonlyTimeline.tsx",
    );
    const { MyCodeIntlProvider } = await f.load("i18n/IntlProvider.tsx");
    const context = {
      workspacePath: "/fixture",
      sessionId: "reasoning-terminal",
      logEpoch: "1",
      theme: "mycode-dark",
      messageStreamShowReasoning: true,
      onOpenCodeViewer() {
        f.counters.preview++;
      },
    };
    const base = (rowId) => ({
      rowId,
      turnId: "summary",
      createdAt: Date.now() - 80000,
      createdAtSeq: rowId,
    });
    const command =
      "  sed -n '40,88p' tools/licenses/main.go; sed -n '116,151p' tools/licenses/main.go; printf '%s' \"original spaces and quotes\"; " +
      "printf '%s' '$& $$'; " +
      "ls -la /fixture/long/path; ".repeat(14);
    let locale = "en-US";
    let state = "complete";
    let durationMs = 6900;
    let startedAt = Date.now() - 5400;
    let toolStatus = "success";
    const render = (patch = {}) => {
      locale = patch.locale ?? locale;
      state = patch.state ?? state;
      durationMs = "durationMs" in patch ? patch.durationMs : durationMs;
      startedAt = patch.startedAt ?? startedAt;
      toolStatus = patch.toolStatus ?? toolStatus;
      const rows = [
        {
          ...base(100),
          createdAt: startedAt,
          kind: "reasoning",
          state,
          text: "Original reasoning content.\n".repeat(40),
          ...(durationMs == null ? {} : { durationMs }),
        },
        ...[undefined, null, 0, 400].map((d, i) => ({
          ...base(101 + i),
          kind: "reasoning",
          state: "complete",
          text: "Historical reasoning",
          ...(d === undefined ? {} : { durationMs: d }),
        })),
        {
          ...base(110),
          kind: "toolCall",
          toolCallId: "sentence-terminal",
          toolName: "Bash",
          status: toolStatus,
          inputText: "",
          input: { command, parsed_cmd: [{ cmd: "only the first parsed statement" }] },
          output: { text: "Original terminal output." },
        },
        {
          ...base(111),
          kind: "toolCall",
          toolCallId: "sentence-read",
          toolName: "Read",
          status: "success",
          inputText: "",
          input: { file_path: "/fixture/read.ts" },
          output: { text: "Original file contents." },
        },
      ];
      window.__summaryFixture.rows = rows;
      f.render({
        empty: true,
        workRows: [{ ...f.rows[0], fileChanges: undefined }, f.rows[9]],
        extra: f.h(
          MyCodeIntlProvider,
          { initialLocale: locale, key: locale },
          f.h(
            "section",
            { "data-header-fixture": "", className: "w-full min-w-0 space-y-2" },
            ...rows.map((row) => f.h(ConversationRowView, { key: row.rowId, row, context })),
            f.h(
              "section",
              { "data-share-header-fixture": "" },
              f.h(ConversationShareReadonlyTimeline, {
                rows: [
                  { ...rows[0], rowId: 200, state: "complete" },
                  { ...rows[5], rowId: 210, toolCallId: "readonly-sentence-terminal" },
                ],
                locale,
              }),
            ),
          ),
        ),
      });
    };
    window.__summaryFixture = {
      render,
      command,
      input: { command, parsed_cmd: [{ cmd: "only the first parsed statement" }] },
      applyTheme: f.applyTheme,
      counters: f.counters,
      host: f.host,
      startedAt,
    };
    render();
  });
  const fixture = page.locator("[data-header-fixture]");
  const reasoning = fixture.locator('[data-row-id="100"]');
  const trigger = reasoning.getByTestId("chat-reasoning-trigger");
  await trigger.waitFor();
  assert.equal((await trigger.innerText()).replace(/\s+/g, " ").trim(), "Reasoning · 6s");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  const bulb = trigger.locator("svg.tabler-icon-bulb");
  const arrow = trigger.locator("svg.tabler-icon-chevron-right");
  assert.equal((await bulb.boundingBox()).width, 16);
  assert.equal((await arrow.boundingBox()).width, 14);
  const titleStyle = await trigger.locator("[data-reasoning-label]").evaluate((el) => ({
    weight: getComputedStyle(el).fontWeight,
    color: getComputedStyle(el).color,
  }));
  assert.equal(titleStyle.weight, "400");
  assert.equal(await arrow.evaluate((el) => getComputedStyle(el).transitionDuration), "0.15s");
  for (const id of [101, 102, 103]) {
    const old = fixture.locator(`[data-row-id="${id}"]`).getByTestId("chat-reasoning-trigger");
    assert.equal(await old.innerText(), "Reasoning");
    assert.equal(await old.locator("[data-reasoning-duration]").count(), 0);
    assert.ok(!(await old.innerText()).includes("·"));
  }
  assert.equal(
    await fixture.locator('[data-row-id="104"] [data-reasoning-duration]').innerText(),
    "1s",
  );
  await trigger.focus();
  await trigger.press("Enter");
  await reasoning.getByTestId("chat-reasoning-content").waitFor();
  assert.ok(
    (await reasoning.getByTestId("chat-reasoning-content").innerText()).includes(
      "Original reasoning content.",
    ),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-row-id="100"] svg.tabler-icon-chevron-right'))
        .rotate === "90deg",
  );
  await trigger.press("Space");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");

  const terminal = fixture.getByTestId("tool-summary-trigger-sentence-terminal");
  const sentence = terminal.locator("[data-tool-summary-sentence]");
  const command = await page.evaluate(() => window.__summaryFixture.command);
  assert.equal(await sentence.textContent(), `Ran ${command}`);
  assert.equal(await terminal.evaluate((el) => el.tagName), "BUTTON");
  assert.equal(await terminal.locator(".tool-summary-kind-label, code").count(), 0);
  assert.equal(await terminal.locator("svg.tabler-icon-terminal-2").count(), 1);
  assert.equal(await terminal.getAttribute("aria-expanded"), "false");
  const typography = await sentence.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      font: s.fontFamily,
      weight: s.fontWeight,
      size: s.fontSize,
      color: s.color,
      wrap: s.whiteSpace,
      overflow: s.overflow,
      ellipsis: s.textOverflow,
      overflowing: el.scrollWidth > el.clientWidth,
    };
  });
  assert.equal(typography.weight, "400");
  assert.equal(typography.wrap, "nowrap");
  assert.equal(typography.overflow, "hidden");
  assert.equal(typography.ellipsis, "ellipsis");
  assert.ok(typography.overflowing);
  assert.equal(
    await terminal
      .locator("svg.tabler-icon-terminal-2")
      .evaluate((el) => getComputedStyle(el).color),
    typography.color,
  );
  await terminal.focus();
  await terminal.press("Enter");
  assert.equal(await terminal.getAttribute("aria-expanded"), "true");
  await fixture.getByText("Original terminal output.", { exact: true }).waitFor();
  assert.equal(await sentence.textContent(), `Ran ${command}`);
  await terminal.press("Space");
  assert.equal(await terminal.getAttribute("aria-expanded"), "false");
  assert.deepEqual(
    await terminal.evaluate((el) => ({
      visible: el.matches(":focus-visible"),
      style: getComputedStyle(el).outlineStyle,
      width: getComputedStyle(el).outlineWidth,
    })),
    { visible: true, style: "solid", width: "2px" },
  );
  await terminal.click();
  assert.equal(await terminal.getAttribute("aria-expanded"), "true");
  await terminal.click();
  const read = fixture.getByTestId("tool-summary-trigger-sentence-read");
  assert.equal(await read.locator("[data-tool-summary-sentence]").count(), 0);
  await read.getByRole("button", { name: "read.ts", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__summaryFixture.counters.preview), 1);

  await page.evaluate(() =>
    window.__summaryFixture.render({
      state: "streaming",
      durationMs: undefined,
      startedAt: Date.now() - 5400,
    }),
  );
  await trigger.getByText("Reasoning…", { exact: true }).waitFor();
  const before = Number(
    (await trigger.locator("[data-reasoning-duration]").innerText()).replace(/\D/g, ""),
  );
  await page.waitForFunction(
    (value) =>
      Number(
        document
          .querySelector('[data-row-id="100"] [data-reasoning-duration]')
          .textContent.replace(/\D/g, ""),
      ) > value,
    before,
    { timeout: 3500 },
  );
  const breathing = await trigger.locator(".reasoning-bulb").evaluate((el) => {
    const a = el.getAnimations()[0];
    return {
      duration: a.effect.getTiming().duration,
      easing: getComputedStyle(el).animationTimingFunction,
      iterations: a.effect.getTiming().iterations === Infinity,
      opacity: a.effect.getKeyframes().map((k) => k.opacity),
    };
  });
  assert.deepEqual(breathing, {
    duration: 1200,
    easing: "ease-in-out",
    iterations: true,
    opacity: ["1", "0.3", "1"],
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-row-id="100"] .reasoning-bulb'))
        .animationName === "none",
  );
  assert.ok((await trigger.innerText()).includes("Reasoning…"));
  const reducedBefore = Number(
    (await trigger.locator("[data-reasoning-duration]").innerText()).replace(/\D/g, ""),
  );
  await page.waitForFunction(
    (value) =>
      Number(
        document
          .querySelector('[data-row-id="100"] [data-reasoning-duration]')
          .textContent.replace(/\D/g, ""),
      ) > value,
    reducedBefore,
    { timeout: 3500 },
  );
  await page.evaluate(() => window.__summaryFixture.render({ state: "complete" }));
  await trigger.getByText("Reasoning", { exact: true }).waitFor();
  const frozen = await trigger.locator("[data-reasoning-duration]").innerText();
  await page.waitForTimeout(1200);
  assert.equal(await trigger.locator("[data-reasoning-duration]").innerText(), frozen);
  assert.equal(
    await trigger.locator(".reasoning-bulb").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });

  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate(
      (locale) => window.__summaryFixture.render({ locale, state: "complete", durationMs: 6900 }),
      locale,
    );
    await trigger
      .getByText(locale === "zh-CN" ? "思考过程" : "Reasoning", { exact: true })
      .waitFor();
    assert.equal(
      await trigger.locator("[data-reasoning-duration]").innerText(),
      locale === "zh-CN" ? "6 秒" : "6s",
    );
    assert.equal(
      await sentence.textContent(),
      `${locale === "zh-CN" ? "已运行" : "Ran"} ${command}`,
    );
    const share = fixture.locator("[data-share-header-fixture]");
    assert.equal(
      (await share.getByTestId("chat-reasoning-trigger").innerText()).replace(/\s+/g, " ").trim(),
      locale === "zh-CN" ? "思考过程 · 6 秒" : "Reasoning · 6s",
    );
    assert.equal(
      await share.locator("[data-tool-summary-sentence]").textContent(),
      `${locale === "zh-CN" ? "已运行" : "Ran"} ${command}`,
    );
    await page.evaluate(() =>
      window.__summaryFixture.render({
        toolStatus: "running",
        state: "streaming",
        durationMs: undefined,
        startedAt: Date.now() - 6400,
      }),
    );
    await trigger
      .getByText(locale === "zh-CN" ? "思考中…" : "Reasoning…", { exact: true })
      .waitFor();
    assert.equal(
      await sentence.textContent(),
      `${locale === "zh-CN" ? "正在运行" : "Running"} ${command}`,
    );
    for (const theme of ["mycode-dark", "mycode-light"]) {
      await page.evaluate((theme) => {
        window.__summaryFixture.applyTheme(theme);
        window.__summaryFixture.render({
          toolStatus: "success",
          state: "complete",
          durationMs: 6900,
        });
      }, theme);
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const colors = await fixture.evaluate((el) => {
          const title = el.querySelector("[data-reasoning-label]");
          const command = el.querySelector("[data-tool-summary-sentence]");
          const weak = el.querySelector("[data-reasoning-duration]");
          return {
            title: getComputedStyle(title).color,
            secondary: getComputedStyle(command).color,
            tertiary: getComputedStyle(weak).color,
            overflow: el.scrollWidth > el.clientWidth + 1,
          };
        });
        assert.equal(colors.title, colors.secondary);
        assert.notEqual(colors.secondary, colors.tertiary);
        assert.equal(colors.overflow, false);
        assert.equal(
          await sentence.textContent(),
          `${locale === "zh-CN" ? "已运行" : "Ran"} ${command}`,
        );
        await page.screenshot({
          path: join(output, `reasoning-terminal-${locale}-${theme}-${width}.png`),
        });
      }
    }
  }
  // 模拟刷新后的重挂：没有保存耗时的完成行不能继承前端冻结值。
  await page.evaluate(() =>
    window.__summaryFixture.render({
      locale: "zh-CN",
      state: "complete",
      durationMs: undefined,
      startedAt: Date.now() - 80000,
    }),
  );
  await page.evaluate(() => window.__summaryFixture.render({ locale: "en-US" }));
  await trigger.getByText("Reasoning", { exact: true }).waitFor();
  assert.equal(await trigger.innerText(), "Reasoning");
  assert.equal(await trigger.locator("[data-reasoning-duration]").count(), 0);
  assert.equal(await page.evaluate(() => "durationMs" in window.__summaryFixture.rows[0]), false);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
  });
  return {
    passed: true,
    locales: ["zh-CN", "en-US"],
    liveTimer: true,
    reducedMotion: true,
    preservedContent: true,
    terminalKeyboard: true,
    readonlyShare: true,
  };
}
