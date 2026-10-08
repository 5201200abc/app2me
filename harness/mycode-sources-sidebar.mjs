import assert from "node:assert/strict";
import { join } from "node:path";
import {
  verifySourceImagePreview,
  verifySourceImageFailure,
} from "./mycode-source-image-preview.mjs";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifySourcesSidebar(page, output) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { SourcesSidePaneContent } = await f.load("app-shell/SourcesSidePane.tsx");
    const { V4ConversationContext } = await f.load("v4/V4ConversationContext.tsx");
    const { ConversationProjectionStore } = await f.load("v4/conversationProjectionStore.ts");
    const { openSourcesSidePane } = await f.load("lib/workspaceSidePane.ts");
    const { WorkspaceHeaderActionSection } = await f.load(
      "WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx",
    );
    const { applyUiFontSizePx, loadUiFontSizePx } = await f.load("lib/uiFontSize.ts");
    applyUiFontSizePx(loadUiFontSizePx());
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    canvas.getContext("2d").fillRect(0, 0, 800, 400);
    f.png = canvas.toDataURL("image/png").split(",")[1];
    const readSource = (request) => {
      f.latestPreviewRead = { sessionId: request.sessionId, ref: request.ref };
      return f.previewReadOverride
        ? f.previewReadOverride(request)
        : Promise.resolve({
            bytes: Uint8Array.from(atob(f.png), (c) => c.charCodeAt(0)),
            mediaType: "image/png",
          });
    };
    f.rows[1].attachments[0] = {
      ...f.rows[1].attachments[0],
      fileName: "codex-clipboard-82a4f593-c212-4d13-a394-0cdbb56035ce.png",
      ref: "/var/folders/fixture/T/codex-clipboard-82a4f593-c212-4d13-a394-0cdbb56035ce.png",
    };
    f.rows.push({
      ...f.rows[11],
      rowId: 13,
      toolCallId: "batch-web",
      toolName: "web__run",
      input: {
        search_query: ["北京天气", "实时气象", "降水量", "天气预报"].map((q) => ({ q })),
        open: [{ ref_id: "https://example.com/page" }, { ref_id: "turn0search0" }],
      },
    });
    f.counters.ranges = 0;
    f.projection = new ConversationProjectionStore("conversation/inventory", {
      onAssemblyFault: () => () => {},
      onRuntimeRestart: () => () => {},
      rowsRange: async () => {
        f.counters.ranges++;
        return { atLogEpoch: "1", rows: f.rows.slice(0, 9), hasMore: false };
      },
    });
    f.projection.setState({
      snapshot: {
        logEpoch: "1",
        rows: { firstRowId: 1, totalCount: f.rows.length, window: f.rows.slice(9) },
      },
    });
    const layer = {
      acquire(sessionId) {
        f.counters.acquired = sessionId;
        return {
          store: f.projection,
          release() {
            f.counters.released = true;
          },
        };
      },
    };
    const { getConversationSourceNameResolver } = await f.load("v4/conversationSourceNames.ts");
    f.sourceNameResolver = getConversationSourceNameResolver(f.projection);
    f.summaryExpanded = true;
    f.renderSidebar = () =>
      f.render({
        sourceNameResolver: f.sourceNameResolver,
        context: {
          workspacePath: "/fixture/default",
          readAttachment: readSource,
          onOpenSources(request) {
            f.panes = openSourcesSidePane(f.panes ?? null, {
              ...request,
              workspaceKey: request.workspaceIdentity || request.workspacePath,
            });
            f.renderSidebar();
          },
        },
        platform: { getDesktopToolEnvironment: () => window.mycode.getDesktopToolEnvironment() },
        extra: f.h(
          "div",
          { className: "conversation-reference-surface", "data-sidebar-fixture": "" },
          f.h(
            "header",
            { "data-header-fixture": "" },
            f.h(WorkspaceHeaderActionSection, {
              variant: "task",
              workspaceAbsPath: "/fixture/default",
              isTerminalOpen: false,
              isSidePaneOpen: false,
              onToggleTerminal() {},
              onToggleSidePane() {},
              isSummaryPanelExpanded: f.summaryExpanded,
              onToggleSummaryPanel() {
                f.summaryExpanded = !f.summaryExpanded;
                f.renderSidebar();
              },
            }),
          ),
          f.panes
            ? f.h(
                "aside",
                {
                  "data-host-sources-pane": "",
                  style: { position: "fixed", right: 0, top: 0, bottom: 0, width: 380, zIndex: 45 },
                },
                f.h(
                  V4ConversationContext.Provider,
                  {
                    value: {
                      layer,
                      attachmentRead: readSource,
                    },
                  },
                  f.h(SourcesSidePaneContent, {
                    tab: f.panes.tabs[0],
                    onOpenBrowserUrl() {
                      f.counters.browser++;
                    },
                  }),
                ),
              )
            : null,
        ),
      });
    f.renderSidebar();
  });
  const fixture = page.locator("#inventory-tool-fixture");
  const inventory = fixture.locator("[data-conversation-inventory]");
  await inventory.getByText("Default", { exact: true }).waitFor();
  assert.equal(await inventory.getByText(/Searched|Opened/).count(), 0);
  const inlineWeb = inventory.locator("[data-source-web-search]");
  await inlineWeb.waitFor();
  assert.equal((await inlineWeb.boundingBox()).height, 28);
  const iconGeometry = await inventory.evaluate((el) => {
    const web = el.querySelector("[data-source-web-search] svg").getBoundingClientRect();
    const tools = [...el.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Mycode App Tools"),
    );
    const logo = tools.querySelector("img").getBoundingClientRect();
    const row = tools.getBoundingClientRect();
    return {
      webWidth: web.width,
      logoWidth: logo.width,
      leftDifference: web.x - logo.x,
      logoCentered: Math.abs(logo.y + logo.height / 2 - row.y - row.height / 2),
    };
  });
  assert.deepEqual(iconGeometry, {
    webWidth: 16,
    logoWidth: 16,
    leftDifference: 0,
    logoCentered: 0,
  });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const right = fixture.locator("[data-host-sources-pane]");
  await right.waitFor();
  await right.getByText("Attached to the conversation", { exact: true }).first().waitFor();
  const imageNames = await right
    .locator("[data-source-kind='screenshot'] button > span > span:first-child")
    .allTextContents();
  for (const name of imageNames) assert.match(name, /^image-[0-9a-f-]{36}$/);
  assert.equal(new Set(imageNames).size, 2);
  const inlineNames = await inventory
    .locator("[data-source-kind='screenshot'] button > span > span:first-child")
    .allTextContents();
  assert.deepEqual(inlineNames, imageNames);
  assert.equal(await right.locator("[data-source-kind='screenshot']").count(), 2);
  assert.equal(
    await right.locator("[data-source-file-path]").textContent(),
    "/var/folders/fixture/T/codex-clipboard-82a4f593-c212-4d13-a394-0cdbb56035ce.png",
  );
  await right.locator("[data-source-tool-environment] img").waitFor();
  const detailGeometry = await right.evaluate((el) => {
    const web = el.querySelector("[data-source-web-search] svg").getBoundingClientRect();
    const logo = el.querySelector("[data-source-tool-environment] img").getBoundingClientRect();
    const webRow = el.querySelector("[data-source-web-search]").getBoundingClientRect();
    const toolRow = el
      .querySelector("[data-source-tool-environment] summary")
      .getBoundingClientRect();
    return {
      webWidth: web.width,
      logoWidth: logo.width,
      leftDifference: web.x - logo.x,
      topDifference: web.y - webRow.y - (logo.y - toolRow.y),
    };
  });
  assert.deepEqual(detailGeometry, {
    webWidth: 16,
    logoWidth: 16,
    leftDifference: 0,
    topDifference: 0,
  });
  await right.getByText("Searched 5 times", { exact: true }).waitFor();
  await right.getByText("Opened 3 pages", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.ranges), 1);
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.acquired), "inventory");
  assert.equal(await fixture.getByRole("dialog").count(), 0);
  const box = await right.boundingBox();
  assert.equal(box.x + box.width, 1280);
  assert.equal(box.width, 380);
  await right.locator("[data-source-kind='screenshot']").first().hover();
  await right.getByRole("button", { name: "复制路径", exact: true }).first().click();
  assert.equal(
    await page.evaluate(() => window.__inventoryFixture.counters.copied),
    "/var/folders/fixture/T/codex-clipboard-82a4f593-c212-4d13-a394-0cdbb56035ce.png",
  );
  await right.getByText("Loaded workspace dependencies once", { exact: true }).waitFor();
  await verifySourceImagePreview(page, right, output, "side-pane");
  await right.locator("[data-source-web-search]").click();
  await right.getByRole("button", { name: /示例/ }).click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.browser), 1);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.panes = null;
    f.renderSidebar();
  });
  await verifySourceImagePreview(page, inventory, output, "summary");
  await verifySourceImageFailure(page, inventory);
  const header = fixture.locator("[data-header-fixture]");
  assert.equal(await header.getByRole("button").count(), 2);
  const toggle = header.getByTestId("workspace-summary-toggle");
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await page.mouse.move(600, 850);
  const active = await toggle.evaluate((el) => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderTopColor,
  }));
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  await page.mouse.move(600, 850);
  await toggle.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
  const inactive = await toggle.evaluate((el) => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderTopColor,
  }));
  assert.notDeepEqual(active, inactive);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.render({ empty: true, context: { onOpenSources: undefined, sessionId: "empty" } });
  });
  const empty = inventory.locator("[data-inventory-empty]");
  await empty.getByText("暂无可用信息", { exact: true }).waitFor();
  assert.equal(await empty.evaluate((el) => [el.tagName, el.tabIndex].join(":")), "P:-1");
  assert.equal(await inventory.getByText("创建文件或网站", { exact: true }).count(), 0);
  assert.equal(await empty.evaluate((el) => getComputedStyle(el).fontSize), "13px");
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--ui-font-size")),
    "14px",
  );
  await page.evaluate(() => window.__inventoryFixture.render({ empty: false }));
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const fallback = page.getByRole("dialog");
  await fallback.waitFor();
  await fallback.getByText("Searched 5 times", { exact: true }).waitFor();
  await fallback.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  const fallbackBox = await fallback.boundingBox();
  assert.equal(Math.round(fallbackBox.x + fallbackBox.width), 1280);
  assert.equal(Math.round(fallbackBox.y), 0);
  assert.equal(await page.locator('[data-slot="dialog-overlay"]').count(), 0);
  await fallback.getByRole("button", { name: "Close", exact: true }).click();
  await fallback.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.counters.failed = true;
    f.render({ hasOlder: true });
  });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const retry = fallback.getByRole("button", { name: "加载失败，点击重试", exact: true });
  await retry.waitFor();
  await page.evaluate(() => {
    window.__inventoryFixture.counters.failed = false;
  });
  await retry.click();
  await retry.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.load), 2);
  await fallback.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.host.classList.add("conversation-reference-surface");
    f.render({
      empty: false,
      workRows: [...f.rows.filter((row) => row.rowId !== 10), { ...f.rows[9], rowId: 14 }],
    });
  });
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationAssistantTextActions } = await f.load("v4/ConversationRowView.tsx");
    f.render({
      extra: f.h(ConversationAssistantTextActions, {
        rowId: 14,
        entityId: "footer-message",
        text: "测试回复",
        createdAt: Date.now(),
        onFork() {},
        onFeedbackChange() {
          return true;
        },
      }),
    });
  });
  const actions = fixture.locator(".conversation-message-actions").last();
  await actions.waitFor();
  assert.equal(await actions.locator("button").count(), 4);
  assert.ok(
    (
      await actions
        .locator("svg")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    ).every((width) => width === 14),
  );
  assert.ok(
    (
      await actions
        .locator("button")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    ).every((width) => width === 24),
  );
  for (const theme of ["mycode-light", "mycode-dark"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    await page.screenshot({ path: join(output, `sources-sidebar-${theme}.png`) });
  }
  await page.setViewportSize({ width: 430, height: 800 });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  await fallback.waitFor();
  await fallback.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  const mobile = await fallback.boundingBox();
  assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 431);
  assert.equal(await fallback.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
  await page.screenshot({ path: join(output, "sources-sidebar-mobile.png") });
  await verifySourceImagePreview(page, fallback, output, "mobile-sources");
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    await f.projection.close();
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
  });
}
