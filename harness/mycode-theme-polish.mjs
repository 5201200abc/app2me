import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyInterfaceTypography } from "./mycode-interface-typography.mjs";
import { mountMyChatControlsFixture } from "./mychat-controls-polish.mjs";

export async function verifyThemePolish(page, output, app) {
  const before = process.argv.includes("--before");
  const contrast = async (foreground, background) =>
    page.evaluate(
      ({ foreground, background }) => {
        const ctx = document.createElement("canvas").getContext("2d");
        const pixel = (color) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        const f = pixel(foreground),
          b = pixel(background);
        const actual = f.slice(0, 3).map((v, i) => (v * f[3]) / 255 + b[i] * (1 - f[3] / 255));
        const lum = (rgb) =>
          rgb
            .map((v) => v / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = lum(actual),
          z = lum(b.slice(0, 3));
        return {
          foreground,
          background,
          effective: actual.map(Math.round),
          ratio: (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05),
        };
      },
      { foreground, background },
    );
  const typography = await verifyInterfaceTypography(page, output, app);
  await page.evaluate(() => window.__inventoryFixture.applyTheme("mycode-dark"));
  const read = async (mode) =>
    page.evaluate((mode) => {
      const root = document.querySelector(
        mode === "mycode" ? "[data-typography-frame]" : "[data-chat-polish]",
      );
      const surface = root.querySelector(".conversation-reference-surface");
      const s = getComputedStyle(surface);
      const tokenNames = [
        "background",
        "sidebar",
        "header",
        "input",
        "foreground",
        "foreground-subtle",
        "foreground-subtlest",
        "brand",
        "border",
        "success",
        "selected",
      ];
      const tokens = Object.fromEntries(
        tokenNames.map((n) => [n, s.getPropertyValue(`--color-${n}`).trim()]),
      );
      const colors = {};
      for (const [name, selector] of Object.entries(
        mode === "mycode"
          ? {
              primary: ".conversation-answer",
              secondary: ".composer-model-trigger",
              auxiliary: ".conversation-work-summary button",
              placeholder: "[data-composer-placeholder]",
              input: "[data-prompt-editor-shell]",
              main: ".conversation-reference-surface",
              sidebar: "[data-typography-sidebar]",
              header: "[data-testid=workspace-header]",
              send: "[data-testid=v4-composer-send]",
            }
          : {
              primary: "[data-testid=mychat-welcome-title]",
              secondary: ".picker-trigger",
              auxiliary: ".side-section-label",
              placeholder: "textarea",
              input: ".composer",
              main: ".conversation-reference-surface",
              sidebar: ".sidebar",
              header: ".mychat-workspace-header",
              send: ".send",
            },
      )) {
        const el = root.querySelector(selector);
        if (!el) continue;
        const c = getComputedStyle(el);
        colors[name] = {
          color: c.color,
          background: c.backgroundColor,
          border: c.borderBottomColor,
          box: el.getBoundingClientRect().toJSON(),
        };
        if (name === "placeholder")
          colors[name].color =
            mode === "mychat" ? getComputedStyle(el, "::placeholder").color : c.color;
      }
      return { mode, tokens, colors };
    }, mode);
  await page.waitForTimeout(200);
  const code = await read("mycode");
  await page.screenshot({ path: join(output, "mycode.png") });
  if (!before) {
    await page.evaluate(async () => {
      const f = window.__inventoryFixture,
        h = f.h;
      const { GroupedDraftTaskRow } = await f.load("workspace-grouped-tasks/draft-task-row.tsx");
      const { ConversationEmptyStatePresentation } = await f.load(
        "v4/ConversationEmptyStatePresentation.tsx",
      );
      const { WorkspaceHeader } = await f.load("WorkspaceHeader.tsx");
      const { Terminal } = await f.load("components/icons/tabler.tsx");
      f.render({
        empty: true,
        extra: h(
          "div",
          {
            "data-theme-draft": "",
            style: { position: "fixed", inset: 4, display: "flex", zIndex: 100 },
          },
          h(
            "aside",
            {
              className: "workspace-sidebar",
              style: { width: 240, padding: 8, background: "var(--color-sidebar)" },
            },
            h("div", { style: { height: 180 } }),
            h(GroupedDraftTaskRow, { active: true, workspaceLabel: "最近的", onSelect() {} }),
          ),
          h(
            "main",
            {
              className: "conversation-reference-surface",
              style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
            },
            h(WorkspaceHeader, {
              variant: "draft",
              workspaceAbsPath: "/fixture/default",
              gitSummary: { isRepository: false },
              gitDirtyFileCount: 0,
              onRefreshGit() {},
              onToggleSidePane() {},
              isSidePaneOpen: false,
            }),
            h(
              "div",
              {
                style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
              },
              h(
                "div",
                { style: { width: 680, maxWidth: "calc(100% - 48px)" } },
                h(ConversationEmptyStatePresentation, {
                  brand: h(Terminal, { className: "size-12 text-foreground-subtle opacity-45" }),
                  greeting: "早上好呀，新的一天开始啦",
                  greetingTestId: "v4-draft-greeting",
                }),
                h(window.__footerBarFixture.Bar, { draft: true }),
              ),
            ),
          ),
        ),
      });
    });
    const draft = page.locator("[data-theme-draft]");
    await draft.locator("[data-composer-project-controls]").waitFor();
    const m = await draft.evaluate((el) => {
      const outer = el.querySelector(".chat-composer-input-surface"),
        input = el.querySelector("[data-prompt-editor-shell]"),
        row = el.querySelector("[data-grouped-draft]");
      return {
        outer: getComputedStyle(outer).backgroundColor,
        outerBorder: getComputedStyle(outer).outlineColor,
        input: getComputedStyle(input).backgroundColor,
        border: getComputedStyle(input).outlineColor,
        dashed: getComputedStyle(row).borderStyle,
        draftBorder: getComputedStyle(row).borderColor,
        draftDot: getComputedStyle(el.querySelector("[data-grouped-draft-dot]")).backgroundColor,
        greeting: getComputedStyle(el.querySelector(".draft-welcome-title")).color,
        usage: el.querySelectorAll('[data-testid="chat-context-usage-trigger"]').length,
      };
    });
    assert.equal(m.outer, "rgb(38, 38, 43)");
    assert.equal(m.input, "rgb(46, 46, 53)");
    assert.equal(m.outerBorder, "rgba(255, 255, 255, 0.08)");
    assert.equal(m.border, m.outerBorder);
    assert.equal(m.dashed, "dashed");
    assert.equal(m.draftBorder, "rgba(255, 255, 255, 0.25)");
    assert.equal(m.greeting, "rgb(236, 236, 241)");
    assert.equal(m.usage, 1);
    await page.screenshot({ path: join(output, "mycode-draft.png") });
    await draft.locator('[contenteditable="true"]').focus();
    await draft
      .locator("[data-prompt-editor-shell]")
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    assert.equal(
      await draft
        .locator("[data-prompt-editor-shell]")
        .evaluate((el) => getComputedStyle(el).outlineColor),
      "rgb(224, 128, 90)",
    );
  }
  await page.evaluate(() => {
    window.__inventoryFixture.root.unmount();
    window.__inventoryFixture.host.remove();
  });
  await mountMyChatControlsFixture(page);
  await page.locator("[data-chat-polish] textarea").waitFor();
  await page.evaluate(() => window.__chatPolish.finish());
  await page.waitForFunction(() => !document.querySelector("[data-chat-polish] textarea").disabled);
  await page.evaluate(() => window.__inventoryFixture.applyTheme("mycode-dark"));
  await page.waitForTimeout(200);
  const chat = await read("mychat");
  const audit = { before: {}, after: {} };
  const saved = JSON.parse(
    await readFile(join(process.cwd(), ".artifacts/theme-polish/before/result.json"), "utf8"),
  );
  const oldCode = saved.typography.metrics[0];
  audit.before.mycode = {
    primary: await contrast(oldCode.body.color, "#1f1f24"),
    secondary: await contrast("#b8b8b9", "#3c3c40"),
    auxiliary: await contrast(oldCode.work.color, "#1f1f24"),
    placeholder: await contrast(oldCode.meta.color, "#3c3c40"),
    days: await contrast(oldCode.dates[0].color, "#1e1e1e"),
  };
  audit.before.mychat = {
    primary: await contrast(saved.chat.colors.primary.color, "#1f1f24"),
    secondary: await contrast(saved.chat.colors.secondary.color, "#3c3c40"),
    placeholder: await contrast(saved.chat.colors.placeholder.color, "#3c3c40"),
  };
  for (const [mode, value] of [
    ["mycode", code],
    ["mychat", chat],
  ]) {
    audit.after[mode] = {};
    for (const [tier, fg] of Object.entries({
      primary: value.tokens.foreground,
      secondary: value.tokens["foreground-subtle"],
      auxiliary: value.tokens["foreground-subtlest"],
      placeholder: mode === "mycode" ? value.tokens["foreground-subtle"] : "#9a9aa3",
    })) {
      audit.after[mode][tier] = [];
      for (const bg of [
        value.tokens.sidebar,
        value.tokens.background,
        value.tokens.input,
        "#333338",
      ]) {
        const pair = await contrast(fg, bg);
        if (!before) assert.ok(pair.ratio >= 4.5, `${mode} ${tier} ${bg} ${pair.ratio}`);
        audit.after[mode][tier].push(pair);
      }
    }
  }
  await writeFile(join(output, "contrast.json"), JSON.stringify(audit, null, 2));
  if (!before) {
    assert.equal(
      await page.locator("[data-chat-polish]").getByTestId("side-pane-toggle").count(),
      0,
    );
    assert.equal(chat.colors.primary.color, "rgb(236, 236, 241)");
    await page.locator("textarea").fill("检查发送按钮");
    await page.waitForTimeout(180);
    assert.equal(
      await page.locator(".send").evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(224, 128, 90)",
    );
    await page.locator("textarea").fill("");
  }
  await page.locator("textarea").evaluate((el) => el.blur());
  await page.waitForTimeout(180);
  await page.screenshot({ path: join(output, "mychat.png") });
  const cdp = await page.context().newCDPSession(page);
  const chatMetrics = [];
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const width of [1512, 390])
      for (const dpr of [1, 2]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 982,
          deviceScaleFactor: dpr,
          mobile: false,
        });
        await page.waitForTimeout(200);
        const metric = await page.locator("[data-chat-polish]").evaluate((el) => {
          const c = el.querySelector(".composer"),
            b = c.getBoundingClientRect();
          return {
            font: getComputedStyle(el.querySelector(".picker-model-name")).fontSize,
            effort: getComputedStyle(el.querySelector(".picker-effort-tag")).fontSize,
            overflow: c.scrollWidth > c.clientWidth || b.right > innerWidth + 1 || b.left < 0,
            sidebar: el.querySelector(".sidebar").getBoundingClientRect().width,
          };
        });
        assert.equal(metric.font, metric.effort);
        assert.equal(metric.overflow, false, JSON.stringify(metric));
        chatMetrics.push({ theme, width, dpr, ...metric });
        const png = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        await writeFile(
          join(output, `mychat-${theme}-${width}-${dpr}x.png`),
          Buffer.from(png.data, "base64"),
        );
      }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  return { passed: true, before, typography, code, chat, audit, chatMetrics };
}
