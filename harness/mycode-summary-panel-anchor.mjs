import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifySummaryPanelAnchor(page, output) {
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture,
      h = f.h;
    const { useState } = window.__fixtureBootstrap.React;
    const { WorkspaceHeader } = await f.load("WorkspaceHeader.tsx");
    const { ConversationStatusPanel } = await f.load("v4/ConversationStatusPanel.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const counts = { locate: 0, add: 0 };
    const model = buildConversationInventory(f.rows, "/fixture/default");
    function Frame({ paneWidth }) {
      const [expanded, setExpanded] = useState(true);
      return h(
        "div",
        {
          "data-anchor-frame": "",
          "data-workspace-conversation-frame": "true",
          className: "flex flex-col overflow-hidden",
          style: {
            position: "fixed",
            top: 4,
            bottom: 4,
            right: 4,
            width: paneWidth ?? "calc(100% - 8px)",
            zIndex: 50,
          },
        },
        h(WorkspaceHeader, {
          variant: "task",
          workspaceAbsPath: "/fixture/default",
          projectName: "Default",
          activeTaskTitle: "对齐验收",
          activeTaskId: null,
          activeTraceId: null,
          activeSessionId: null,
          activeTaskProvider: "glm",
          gitSummary: { isRepository: false },
          gitDirtyFileCount: 0,
          workspaceHeaderState: { selectedProvider: "glm" },
          isSidebarVisible: true,
          isDesktop: true,
          isMacDesktop: true,
          isTerminalOpen: false,
          isSidePaneOpen: false,
          onRefreshGit() {},
          onToggleTerminal() {},
          onToggleSidePane() {},
          isSummaryPanelExpanded: expanded,
          onToggleSummaryPanel: () => setExpanded((value) => !value),
        }),
        h(
          "div",
          {
            className:
              "conversation-reference-surface @container/conversation relative flex min-h-0 flex-1 flex-col",
          },
          h(
            "div",
            {
              "data-anchor-scroll": "",
              style: { position: "absolute", inset: 0, overflowY: "scroll" },
            },
            h("div", { style: { height: 1800 } }),
          ),
          h(ConversationStatusPanel, {
            workspacePath: "/fixture/default",
            layoutMode: "inline",
            showEmpty: true,
            summaryPanelVariantOverride: expanded ? "panel" : "mini",
            inventory: {
              model,
              rows: f.rows,
              context: { workspacePath: "/fixture/default", sessionId: "anchor", logEpoch: "1" },
              hasOlder: false,
              onLocate: () => counts.locate++,
              onAddSource: () => counts.add++,
              onLoadAll: async () => ({ status: "hydrated", logEpoch: "1" }),
            },
          }),
        ),
      );
    }
    const render = (paneWidth) => f.render({ empty: true, extra: h(Frame, { paneWidth }) });
    window.__anchorFixture = { render, counts };
    render();
  });
  const frame = page.locator("[data-anchor-frame]");
  const panel = frame.getByTestId("chat-summary-panel");
  await panel.waitFor();
  const metrics = [];
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const width of [1440, 800, 390, 280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const paneWidth of width === 1440 ? [undefined, 220] : [undefined]) {
        await page.evaluate((width) => window.__anchorFixture.render(width), paneWidth);
        await page.waitForFunction((width) => {
          const el = document.querySelector("[data-anchor-frame]");
          return Math.abs(el.getBoundingClientRect().width - (width ?? innerWidth - 8)) <= 1;
        }, paneWidth);
        const m = await frame.evaluate((el) => {
          const rect = (selector) => el.querySelector(selector).getBoundingClientRect();
          const panel = el.querySelector('[data-testid="chat-summary-panel"]');
          const box = panel.getBoundingClientRect();
          const header = rect('[data-testid="workspace-header"]');
          const trigger = rect('[data-testid="workspace-summary-toggle"]');
          const lastButton = rect('[data-testid="side-pane-toggle"]');
          const scroller = el.querySelector("[data-anchor-scroll]");
          const scrollBox = scroller.getBoundingClientRect();
          // macOS 覆盖式滚动条不占 clientWidth，轨道宽度需读取现有伪元素样式。
          const scrollbarWidth = Number.parseFloat(
            getComputedStyle(scroller, "::-webkit-scrollbar").width,
          );
          scroller.scrollTop = 160;
          const inventory = panel.querySelector("[data-conversation-inventory]");
          const style = getComputedStyle(inventory);
          const title = inventory
            .querySelector("[data-inventory-title-row]")
            .getBoundingClientRect();
          const plus = inventory.querySelector('[aria-label="产物菜单"]').getBoundingClientRect();
          const change = inventory.querySelector("[data-inventory-change]").getBoundingClientRect();
          const row = inventory.querySelector("[data-source-summary-row]").getBoundingClientRect();
          return {
            frame: el.getBoundingClientRect().toJSON(),
            panel: box.toJSON(),
            header: header.toJSON(),
            alignment: box.right - lastButton.right,
            trigger: trigger.toJSON(),
            scrollbarWidth,
            scrollTop: scroller.scrollTop,
            scrollbarGap: scrollBox.right - scrollbarWidth - box.right,
            topGap: box.top - header.bottom,
            triggerGap: box.top - trigger.bottom,
            padding: [style.paddingLeft, style.paddingRight],
            lefts: [title.left, change.left, row.left],
            rights: [title.right, plus.right, change.right, row.right],
            appearance: {
              background: getComputedStyle(panel).backgroundColor,
              font: getComputedStyle(inventory.querySelector("h3")).fontSize,
              radius: getComputedStyle(panel).borderRadius,
            },
          };
        });
        assert.ok(Math.abs(m.alignment + 8) <= 1, JSON.stringify(m));
        assert.equal(m.scrollbarWidth, 14);
        assert.equal(m.scrollTop, 160);
        assert.ok(m.scrollbarGap >= 2, JSON.stringify(m));
        assert.equal(m.topGap, 8);
        assert.ok(
          Math.abs(m.triggerGap - (8 + (48 - m.trigger.height) / 2)) < 0.1,
          JSON.stringify(m),
        );
        assert.ok(
          m.panel.left >= m.frame.left + 8 - 1 && m.panel.right <= m.frame.right - 16 + 1,
          JSON.stringify(m),
        );
        assert.ok(
          Math.abs(m.panel.width - Math.min(280, m.frame.width - 24)) <= 1,
          JSON.stringify(m),
        );
        assert.deepEqual(m.padding, ["12px", "12px"]);
        assert.equal(new Set(m.lefts).size, 1);
        assert.equal(new Set(m.rights).size, 1);
        assert.equal(m.appearance.radius, "16px");
        metrics.push({ theme, width, paneWidth, ...m });
        await frame.screenshot({
          path: join(output, `anchor-${theme}-${width}-${paneWidth ?? "full"}.png`),
        });
      }
    }
  }
  await frame.getByTestId("workspace-summary-toggle").click();
  await panel.waitFor({ state: "detached" });
  await frame.getByTestId("workspace-summary-toggle").click();
  await panel.waitFor();
  await panel.locator("[data-inventory-change]").click();
  await panel.getByRole("button", { name: "添加来源", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__anchorFixture.counts), { locate: 1, add: 1 });
  return { passed: true, metrics };
}
