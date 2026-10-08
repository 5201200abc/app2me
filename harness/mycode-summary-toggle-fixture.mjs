import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySummaryToggle(page, output) {
  await page.evaluate(async (cwd) => {
    const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
    const reactModule = await import(urls.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(urls.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url)));
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
    const { WorkspaceHeaderActionSection } = await load("WorkspaceHeaderSections.tsx");
    const { ConversationStatusPanel } = await load("v4/ConversationStatusPanel.tsx");
    const { useConversationSummarySelection } = await load(
      "hooks/useConversationSummarySelection.ts",
    );
    const { resolveConversationSummaryPanelVariant } = await load(
      "v4/conversationSummaryPanelState.ts",
    );
    const { getConversationContentWidthClassName, getConversationStatusPanelOffsetClassName } =
      await load("v4/conversationLayout.ts");
    const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
    const { PlatformProvider } = await load("hooks/usePlatform.tsx");
    const { TooltipProvider } = await load("components/ui/tooltip.tsx");
    const { applyTheme } = await load("useTheme.ts");
    const host = document.createElement("div");
    host.id = "summary-toggle-fixture";
    host.style.cssText = "position:fixed;inset:0;z-index:10000;background:var(--color-background)";
    document.body.append(host);
    const root = createRoot(host);
    const h = React.createElement;
    const api = { root, host, applyTheme };
    window.__summaryToggleFixture = api;
    function Fixture() {
      const [scope, setScope] = React.useState("session-a");
      const [_answering, setAnswering] = React.useState(false);
      const [empty, setEmpty] = React.useState(false);
      const [draft, setDraft] = React.useState(false);
      const selection = useConversationSummarySelection(JSON.stringify(["fixture", scope]));
      const variant = resolveConversationSummaryPanelVariant(selection.variantOverride);
      const expanded = variant === "panel";
      const layout = expanded ? "inline" : "none";
      Object.assign(api, { setScope, setAnswering, setEmpty, setDraft, selection });
      return h(
        "div",
        { className: "flex h-full flex-col text-foreground" },
        h(
          "header",
          { className: "flex h-12 shrink-0 justify-end border-b border-border/50 p-2" },
          h(WorkspaceHeaderActionSection, {
            variant: draft ? "draft" : "task",
            workspaceAbsPath: cwd,
            isTerminalOpen: false,
            isSidePaneOpen: false,
            onToggleTerminal() {},
            onToggleSidePane() {},
            isSummaryPanelExpanded: expanded,
            onToggleSummaryPanel: () => selection.setVariantOverride(expanded ? "mini" : "panel"),
          }),
        ),
        h(
          "main",
          { className: "@container/conversation relative min-h-0 flex-1 overflow-auto" },
          !draft
            ? h(ConversationStatusPanel, {
                workspacePath: cwd,
                layoutMode: layout,
                summaryPanelVariantOverride: variant,
                onVariantChange: selection.setVariantOverride,
                showEmpty: expanded,
                plan: empty
                  ? null
                  : {
                      items: [{ id: "fixture-plan", content: "验证摘要计划", status: "pending" }],
                    },
                parentSessionId: scope,
              })
            : null,
          h(
            "div",
            {
              "data-summary-reading-column": true,
              className: [
                "mx-auto px-6 py-6",
                getConversationContentWidthClassName({
                  centeredEmptyLayout: false,
                  statusPanelLayout: layout,
                }),
                getConversationStatusPanelOffsetClassName(layout),
              ]
                .filter(Boolean)
                .join(" "),
            },
            h(
              "p",
              { className: "text-ui-base leading-5.5" },
              "验证摘要开关与消息列共享布局，原有计划仍可访问。",
            ),
            h("textarea", {
              className: "mt-4 w-full rounded-2xl border border-border bg-input p-3 text-ui-base",
              defaultValue: "提出后续修改要求",
            }),
          ),
        ),
      );
    }
    root.render(
      h(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        h(
          PlatformProvider,
          { platform: { getInstalledEditors: async () => [] } },
          h(TooltipProvider, null, h(Fixture)),
        ),
      ),
    );
  }, process.cwd());
  const fixture = page.locator("#summary-toggle-fixture");
  const button = fixture.getByTestId("workspace-summary-toggle");
  const panel = fixture.locator("[data-display-mode]");
  const render = (key, value) =>
    page.evaluate(({ key, value }) => window.__summaryToggleFixture[key](value), { key, value });
  try {
    await button.waitFor();
    assert.equal(await button.getAttribute("aria-label"), "切换置顶摘要");
    assert.equal(await button.locator("circle").count(), 2);
    assert.equal(await button.locator("svg").getAttribute("stroke-width"), "1.5");
    assert.equal((await button.locator("svg").boundingBox()).width, 14);
    await button.hover();
    await page.getByRole("tooltip", { name: "切换置顶摘要", exact: true }).waitFor();
    await fixture.locator("textarea").hover();
    const waitMode = (mode) =>
      page.waitForFunction(
        (mode) =>
          document.querySelector("#summary-toggle-fixture [data-display-mode]")?.dataset
            .displayMode === mode,
        mode,
      );
    await waitMode("panel");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    await render("setAnswering", true);
    await waitMode("panel");
    await render("setAnswering", false);
    await waitMode("panel");
    await button.press("Space");
    await waitMode("mini");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    for (const answering of [true, false, true]) {
      await render("setAnswering", answering);
      await waitMode("mini");
    }
    await render("setScope", "session-b");
    await waitMode("panel");
    await render("setAnswering", false);
    await waitMode("panel");
    await render("setEmpty", true);
    await panel.getByText("暂无置顶摘要", { exact: true }).waitFor();
    await button.click();
    await panel.waitFor({ state: "detached" });
    await button.click();
    for (const theme of ["mycode-light", "mycode-dark"]) {
      await page.evaluate((theme) => window.__summaryToggleFixture.applyTheme(theme), theme);
      for (const width of [390, 800, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await fixture.evaluate((el) => {
          const button = el.querySelector('[data-testid="workspace-summary-toggle"]');
          const panel = el.querySelector("aside").getBoundingClientRect();
          const column = el.querySelector("[data-summary-reading-column]").getBoundingClientRect();
          return {
            overflow: el.scrollWidth > el.clientWidth + 1,
            button: button.getBoundingClientRect().height,
            panel: { left: panel.left, right: panel.right, bottom: panel.bottom },
            column: { right: column.right, top: column.top },
          };
        });
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.button, 28);
        assert.ok(geometry.panel.left >= 0 && geometry.panel.right <= width);
        if (width >= 640) assert.ok(geometry.column.right <= geometry.panel.left);
        else assert.ok(geometry.column.top >= geometry.panel.bottom);
        await page.screenshot({ path: join(output, `summary-toggle-${theme}-${width}.png`) });
      }
    }
    await render("setDraft", true);
    await button.waitFor({ state: "detached" });
  } finally {
    await page.evaluate(() => {
      const f = window.__summaryToggleFixture;
      f.root.unmount();
      f.host.remove();
      delete window.__summaryToggleFixture;
    });
  }
}
