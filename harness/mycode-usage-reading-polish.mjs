import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyUsageReadingPolish(page, output) {
  for (const target of ["desktop", "web"]) {
    const config = await resolveConfig(
      { configFile: `packages/${target}/vite.config.ts` },
      "serve",
    );
    assert.ok(config.optimizeDeps.include.includes("recharts"));
    assert.ok(config.optimizeDeps.include.includes("react"));
    assert.ok(config.optimizeDeps.include.includes("react-dom/client"));
    assert.ok(config.resolve.dedupe.includes("react"));
  }
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { AppUsagePanel } = await f.load("settings/usage-stats/AppUsagePanel.tsx");
    const { ServiceProvider } = await f.load("hooks/useServices.tsx");
    const now = Date.now();
    const summary = Object.fromEntries(
      [
        "totalTokens",
        "inputTokens",
        "outputTokens",
        "reasoningTokens",
        "cacheCreationTokens",
        "cacheReadTokens",
        "cacheHitRate",
        "totalSessions",
        "totalTurns",
        "toolCallCount",
        "toolErrorRate",
        "modelErrorRate",
        "activeDays",
        "currentStreakDays",
        "longestSessionMs",
        "longestStreakDays",
        "peakDayTokens",
      ].map((key) => [key, 0]),
    );
    const requests = [];
    let empty = false;
    const service = {
      async getAppUsageSnapshot({ range }) {
        requests.push(range);
        const totalTokens = empty ? 0 : range === "30d" ? 30000 : 7000;
        return {
          range,
          generatedAt: now,
          timeZone: "UTC",
          source: "agent-db",
          summary: {
            ...summary,
            totalTokens,
            peakDayTokens: totalTokens,
            favoriteModel: null,
            avgTimeToFirstTokenMs: null,
            avgTurnDurationMs: null,
          },
          heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
          dailyModelUsage: empty
            ? []
            : [
                {
                  date: "2026-10-06",
                  models: [{ modelId: "test-model", totalTokens: totalTokens * 0.4 }],
                },
                {
                  date: "2026-10-07",
                  models: [{ modelId: "test-model", totalTokens: totalTokens * 0.6 }],
                },
              ],
          models: empty
            ? []
            : [
                {
                  modelId: "test-model",
                  totalTokens,
                  inputTokens: totalTokens / 2,
                  outputTokens: totalTokens / 2,
                  requestCount: 2,
                  share: 1,
                },
              ],
          tools: [],
        };
      },
    };
    window.__usageFixture = {
      requests,
      setEmpty(value) {
        empty = value;
      },
    };
    f.render({
      empty: true,
      extra: f.h(
        "div",
        { "data-usage-fixture": "", style: { width: 720 } },
        f.h(ServiceProvider, { services: { usageStatsService: service } }, f.h(AppUsagePanel)),
      ),
    });
  });
  const fixture = page.locator("[data-usage-fixture]");
  await fixture.getByRole("tab", { name: "近 7 日" }).waitFor();
  await fixture.locator(".recharts-line-curve").waitFor({ state: "attached" });
  await fixture.locator(".recharts-pie-sector").waitFor();
  assert.equal(await fixture.getByText("这块界面出了点问题").count(), 0);
  await fixture.getByRole("tab", { name: "近 30 日" }).click();
  await page.waitForFunction(() => window.__usageFixture.requests.includes("30d"));
  await fixture.locator(".recharts-line-curve").waitFor({ state: "attached" });
  await fixture.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(
    () => window.__usageFixture.requests.filter((r) => r === "30d").length >= 2,
  );
  await page.waitForFunction(() => {
    const path = document.querySelector("[data-usage-fixture] .recharts-pie-sector path");
    if (!path) return false;
    const box = path.getBoundingClientRect();
    const outer = path
      .getAttribute("d")
      .split("L")[0]
      .match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)
      ?.map(Number);
    return (
      box.width > 0 &&
      box.height >= box.width * 0.98 &&
      outer &&
      Math.hypot(outer[0] - outer.at(-2), outer[1] - outer.at(-1)) < 0.01
    );
  });
  assert.ok((await fixture.innerText()).includes("3万"));
  await fixture.screenshot({ path: join(output, "usage-nonempty.png") });
  await page.evaluate(() => window.__usageFixture.setEmpty(true));
  await fixture.getByRole("tab", { name: "近 7 日" }).click();
  await page.waitForFunction(
    () => !document.querySelector("[data-usage-fixture] .recharts-pie-sector"),
  );
  assert.equal(await fixture.getByText("这块界面出了点问题").count(), 0);
  await fixture.screenshot({ path: join(output, "usage-empty.png") });
  const requests = await page.evaluate(() => window.__usageFixture.requests);
  await verifyReadingDetails(page, output);
  return { passed: true, requests };
}

async function verifyReadingDetails(page, output) {
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationInventory } = await f.load("v4/ConversationInventory.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const { ConversationSourceRow } = await f.load("v4/ConversationSourceRow.tsx");
    const { applyUiFontSizePx, loadUiFontSizePx, UI_FONT_SIZE_STORAGE_KEY } =
      await f.load("lib/uiFontSize.ts");
    localStorage.removeItem(UI_FONT_SIZE_STORAGE_KEY);
    applyUiFontSizePx(loadUiFontSizePx());
    const context = { workspacePath: "/fixture/default", sessionId: "reading", logEpoch: "1" };
    const model = buildConversationInventory(f.rows, context.workspacePath);
    model.sources = model.sources
      .filter((s) => s.kind === "screenshot")
      .map((s) => ({ ...s, thumbnail: `data:image/png;base64,${f.png}` }));
    f.render({
      empty: true,
      extra: f.h(
        "div",
        {
          "data-reading-fixture": "",
          className: "conversation-reference-surface",
          style: { width: 300 },
        },
        f.h(
          "aside",
          { "data-testid": "chat-summary-panel", "data-state": "expanded" },
          f.h(ConversationInventory, {
            model,
            context,
            rows: f.rows,
            hasOlder: false,
            onLoadAll: async () => ({ status: "hydrated" }),
            onLocate: () => f.counters.locate++,
          }),
        ),
        f.h(
          "div",
          { "data-detail-source": "" },
          f.h(ConversationSourceRow, {
            item: model.sources[0],
            context,
            detail: true,
            onOpen: () => {},
          }),
        ),
      ),
    });
  });
  const fixture = page.locator("[data-reading-fixture]");
  const source = fixture.locator("[data-conversation-inventory] [data-source-kind]").first();
  await source.locator("img").waitFor();
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    const m = await fixture.evaluate((el) => {
      const heading = el.querySelector("h3"),
        change = el.querySelector("[data-inventory-change]"),
        icon = change.querySelector("[data-diff-icon]"),
        title = el.querySelector("[data-inventory-source-title]"),
        img = el.querySelector("[data-conversation-inventory] [data-source-kind] img");
      return {
        base: getComputedStyle(document.documentElement).getPropertyValue("--ui-font-size"),
        font: getComputedStyle(heading).fontSize,
        iconLeft: icon.getBoundingClientRect().left,
        headingLeft: heading.getBoundingClientRect().left,
        gap: getComputedStyle(change).columnGap,
        imgLeft: img.getBoundingClientRect().left,
        titleLeft: title.getBoundingClientRect().left,
        imgWidth: img.getBoundingClientRect().width,
        imgHeight: img.getBoundingClientRect().height,
        radius: getComputedStyle(img).borderRadius,
        detailWidth: el.querySelector("[data-detail-source] img").getBoundingClientRect().width,
      };
    });
    assert.equal(m.base.trim(), "15px");
    assert.equal(m.font, "15px");
    assert.equal(m.iconLeft, m.headingLeft);
    assert.equal(m.gap, "6px");
    assert.equal(m.imgLeft, m.titleLeft);
    assert.equal(m.imgWidth, 16);
    assert.equal(m.imgHeight, 16);
    assert.equal(m.radius, "4px");
    assert.equal(m.detailWidth, 28);
    await fixture.screenshot({ path: join(output, `reading-${theme}.png`) });
  }
  await source.getByRole("button").click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await fixture.locator("[data-inventory-change]").click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.locate), 1);
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const font = await f.load("lib/uiFontSize.ts");
    localStorage.setItem(font.UI_FONT_SIZE_STORAGE_KEY, "14");
    if (font.loadUiFontSizePx() !== 14) throw Error("Existing font preference changed");
    font.applyUiFontSizePx(font.loadUiFontSizePx());
    localStorage.removeItem(font.UI_FONT_SIZE_STORAGE_KEY);
    font.applyUiFontSizePx(font.loadUiFontSizePx());
  });
}
