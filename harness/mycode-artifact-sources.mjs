import assert from "node:assert/strict";
import { join } from "node:path";
import { verifyTaskRowRefinement } from "./mycode-sidebar-refinement.mjs";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyArtifactSources(page, output) {
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationFileSummaryPanel } = await f.load("v4/ConversationFileSummaryPanel.tsx");
    const { AssistantPreviewCards } = await f.load("AssistantPreviewCards.tsx");
    const { ConversationSourcesTab } = await f.load("v4/ConversationSourcesTab.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const paths = ["/fixture/mycode/app.ts", "/fixture/mycode/style.css"];
    f.counters.diffs = [];
    f.counters.browsers = [];
    f.counters.sources = 0;
    const context = {
      workspacePath: "/fixture/mycode",
      sessionId: "inventory",
      theme: "mycode-dark",
      onOpenCodeViewer: (source) => f.counters.diffs.push(source),
      fetchFileChanges: async () => ({
        items: paths.slice(0, f.fileCount).map((path) => ({
          path,
          additions: 12,
          deletions: 3,
          patches: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
          ],
        })),
      }),
      onOpenSources: () => {
        f.counters.sources++;
        f.sourcesOpen = true;
        render();
      },
    };
    f.fileCount = 1;
    const render = () => {
      const cards = [
        {
          id: "website",
          type: "website",
          title: "app.html",
          subtitleId: "chat.previewCards.htmlWebsite",
          url: "http://localhost:8080/app.html",
        },
      ];
      f.render({
        context,
        platform: {
          getWebsiteBrowsers: async () => [
            { id: "chrome", name: "Chrome" },
            { id: "safari", name: "Safari" },
          ],
          openWebsiteBrowser: async (id, url) => {
            f.counters.browsers.push({ id, url });
            return { success: true };
          },
          getDesktopToolEnvironment: () => window.mycode.getDesktopToolEnvironment(),
        },
        extra: f.h(
          "div",
          { "data-artifact-fixture": "" },
          f.h(ConversationFileSummaryPanel, {
            header: {
              ...f.rows[0],
              entityId: "turn",
              fileChanges: {
                files: f.fileCount,
                additions: 12 * f.fileCount,
                deletions: 3 * f.fileCount,
              },
            },
            context,
          }),
          f.h(AssistantPreviewCards, { cards, onOpenBrowserUrl: () => f.counters.browser++ }),
          f.sourcesOpen
            ? f.h(
                "aside",
                {
                  "data-sources-right-fixture": "",
                  style: { width: 360, height: 460, marginLeft: "auto" },
                },
                f.h(ConversationSourcesTab, {
                  items: buildConversationInventory(f.rows, context.workspacePath).sources,
                  webActivity: buildConversationInventory(f.rows, context.workspacePath)
                    .webActivity,
                  context,
                  onOpen() {},
                }),
              )
            : null,
        ),
      });
    };
    f.renderArtifacts = render;
    render();
  });
  const fixture = page.locator("#inventory-tool-fixture");
  const artifacts = fixture.locator("[data-artifact-fixture]");
  const card = artifacts.locator("[data-conversation-file-summary]");
  await card.getByText("已编辑 app.ts", { exact: true }).waitFor();
  assert.match(await card.innerText(), /\+12/);
  await card.getByRole("button", { name: "查看变更", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__inventoryFixture.counters.diffs[0].type),
    "patch",
  );
  assert.equal(
    await page.evaluate(() => window.__inventoryFixture.counters.diffs[0].workspacePath),
    "/fixture/mycode",
  );
  await page.evaluate(() => {
    window.__inventoryFixture.fileCount = 2;
    window.__inventoryFixture.renderArtifacts();
  });
  await card.getByText("已编辑 2 个文件", { exact: true }).waitFor();
  await card.getByRole("button", { name: "查看变更", exact: true }).click();
  await card.getByRole("button").filter({ hasText: "style.css" }).waitFor();
  const website = artifacts.locator("[data-assistant-preview-card]");
  await website.getByText("app.html", { exact: true }).waitFor();
  await website.getByRole("button", { name: "打开", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.browser), 1);
  await website.getByRole("button", { name: /选择打开/ }).click();
  await page.getByRole("menuitem", { name: "Chrome", exact: true }).waitFor();
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Chrome", "Safari"]);
  await page.getByRole("menuitem", { name: "Safari", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__inventoryFixture.counters.browsers[0].id),
    "safari",
  );
  const inventory = fixture.locator("[data-conversation-inventory]");
  const inlineCount = await inventory.locator("[data-source-kind]").count();
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const sources = fixture.locator("[data-sources-right-fixture]");
  await sources.waitFor();
  assert.equal(await inventory.locator("[data-source-kind]").count(), inlineCount);
  assert.equal(await inventory.getByRole("button", { name: "折叠全部", exact: true }).count(), 0);
  assert.equal(await sources.locator("[data-source-kind]").count(), 2);
  await sources.locator("[data-source-web-search]").click();
  assert.equal(await sources.locator("[data-source-kind]").count(), 4);
  const environment = sources.locator("[data-source-tool-environment]");
  await environment.getByText("Mycode App Tools", { exact: true }).waitFor();
  await environment.locator("summary").click();
  const expected = await page.evaluate(() => window.mycode.getDesktopToolEnvironment());
  assert.ok(expected.nodePath && expected.nodeVersion && expected.bundleVersion);
  assert.ok((await environment.innerText()).includes(expected.nodePath));
  assert.ok((await environment.innerText()).includes(expected.nodeVersion));
  assert.equal(await environment.getByText(/安装|报错|Loaded workspace/).count(), 0);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    const todo = {
      ...f.rows[6],
      toolName: "TodoWrite",
      input: { todos: [{ content: "不应出现的步骤", status: "pending" }] },
      output: { text: "不应出现的步骤" },
    };
    f.render({ workRows: [f.rows[0], f.rows[1], todo, f.rows[9]] });
  });
  assert.equal(await fixture.getByText("不应出现的步骤").count(), 0);
  for (const theme of ["mycode-light", "mycode-dark"]) {
    await page.evaluate((theme) => {
      const f = window.__inventoryFixture;
      f.applyTheme(theme);
      f.renderArtifacts();
    }, theme);
    await page.screenshot({ path: join(output, `artifact-sources-${theme}.png`) });
  }
  await page.setViewportSize({ width: 430, height: 800 });
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-artifact-fixture]");
    return el && el.scrollWidth <= el.clientWidth + 1;
  });
  await page.screenshot({ path: join(output, "artifact-sources-mobile.png") });
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
    delete window.__inventoryFixture;
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  await verifyTaskRowRefinement(page, output, true);
}
