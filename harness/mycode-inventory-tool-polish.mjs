import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyInventoryToolPolish(page, output) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByTestId("settings-page");
  await settings.waitFor();
  const integrations = settings.locator('[aria-labelledby="settings-sidebar-group-integrations"]');
  assert.deepEqual(
    await integrations.locator('[data-testid^="settings-section-nav-"]').allTextContents(),
    ["插件", "电脑控制", "浏览器"],
  );
  assert.equal(
    await settings.getByTestId("settings-section-nav-modelProvider").innerText(),
    "模型",
  );
  await settings.getByTestId("settings-section-nav-browser").click();
  for (const text of ["Chrome 登录状态", "清除缓存", "清除全部数据"])
    await settings.getByText(text, { exact: true }).first().waitFor();
  assert.equal(await settings.getByRole("button", { name: "导入", exact: true }).count(), 1);
  await settings.getByTestId("settings-section-nav-appearance").click();
  const font = settings.getByRole("group", { name: "代码字号", exact: true });
  for (let n = 0; n < 8; n++) {
    const minus = font.getByRole("button", { name: /-1 px$/ });
    if (await minus.isDisabled()) break;
    await minus.click();
  }
  assert.equal(await font.locator("output").textContent(), "11");
  assert.equal(await font.getByRole("button", { name: /-1 px$/ }).isDisabled(), true);
  for (let n = 0; n < 5; n++) await font.getByRole("button", { name: /\+1 px$/ }).click();
  assert.equal(await font.locator("output").textContent(), "16");
  assert.equal(await font.getByRole("button", { name: /\+1 px$/ }).isDisabled(), true);
  assert.equal((await font.boundingBox()).height, 26);
  await settings.getByTestId("settings-section-nav-plugin").click();
  for (const name of ["插件", "MCP", "技能", "子智能体"]) {
    await settings.getByRole("tab", { name, exact: true }).click();
    const trigger = settings.locator("[data-plugin-scope-trigger]:visible");
    await trigger.click();
    assert.equal(await page.getByRole("menuitemradio", { name: /default/ }).count(), 0);
    await page.keyboard.press("Escape");
  }
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  const fixture = page.locator("#inventory-tool-fixture");
  const panel = fixture.locator('[data-testid="chat-summary-panel"]');
  await fixture.locator("[data-conversation-inventory]").waitFor();
  await fixture.evaluate((el) => el.classList.add("conversation-reference-surface"));
  const inventory = fixture.locator("[data-conversation-inventory]");
  const panelStyle = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: el.getBoundingClientRect().width,
      bg: s.backgroundColor,
      radius: s.borderRadius,
      shadow: s.boxShadow,
      left: s.borderLeftWidth,
      top: s.borderTopWidth,
    };
  });
  assert.equal(panelStyle.width, 216);
  assert.notEqual(panelStyle.bg, "rgba(0, 0, 0, 0)");
  assert.equal(panelStyle.radius, "16px");
  assert.equal(panelStyle.shadow, "none");
  assert.equal(panelStyle.left, "0px");
  assert.equal(panelStyle.top, "0px");
  assert.equal(await inventory.getByRole("heading", { name: "mycode", exact: true }).count(), 1);
  const spacing = await inventory.evaluate((el) => ({
    bottom: getComputedStyle(el).paddingBottom,
    titleGap: getComputedStyle(el.querySelector("[data-inventory-title-row]")).marginBottom,
  }));
  assert.deepEqual(spacing, { bottom: "10px", titleGap: "6px" });
  assert.equal(await inventory.getByText("Sources", { exact: true }).count(), 1);
  assert.equal(await inventory.locator('[data-source-kind="mcp"]').count(), 0);
  await page.evaluate(() =>
    window.__inventoryFixture.render({
      liveChanges: { files: 1, additions: 453, deletions: 7 },
      thinking: true,
    }),
  );
  await inventory.locator("[data-inventory-change]").filter({ hasText: "+453" }).waitFor();
  const changes = inventory.locator("[data-inventory-change]");
  assert.match(await changes.innerText(), /−7/);
  const colors = await changes.evaluate((el) =>
    [...el.querySelectorAll(".text-diff-added,.text-diff-removed")].map(
      (node) => getComputedStyle(node).color,
    ),
  );
  assert.notEqual(colors[0], colors[1]);
  assert.equal(await inventory.locator("[data-inventory-item]").count(), 0);
  const summary = fixture.locator(".conversation-work-summary");
  const work = fixture.locator(".conversation-work-log");
  await summary.getByRole("button").click();
  await work.getByTestId("chat-reasoning-trigger").waitFor();
  assert.equal(await summary.evaluate((el) => getComputedStyle(el).marginBottom), "8px");
  assert.equal(await work.evaluate((el) => getComputedStyle(el).paddingTop), "0px");
  await page.evaluate(() => window.__inventoryFixture.render({ thinking: false }));

  assert.equal(await inventory.locator("[data-source-kind]").count(), 2);
  await inventory.getByRole("button", { name: "添加来源" }).click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.add), 1);
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  assert.equal(await inventory.locator("[data-source-kind]").count(), 2);
  assert.equal(await inventory.getByRole("button", { name: "折叠全部", exact: true }).count(), 0);
  const sourceTab = page.locator("[data-conversation-sources-tab]");
  await sourceTab.waitFor();
  await sourceTab.getByText("Searched 1 times", { exact: true }).waitFor();
  await sourceTab.getByText("Opened 1 pages", { exact: true }).waitFor();
  assert.equal(
    await sourceTab.getByText("Attached to the conversation", { exact: true }).count(),
    2,
  );
  await sourceTab.locator("[data-source-web-search]").click();
  const details = sourceTab.locator("[data-source-kind]");
  assert.equal(await details.count(), 4);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-conversation-sources-tab] [data-source-kind]")].every(
      (el) =>
        el.getBoundingClientRect().height >= (el.dataset.sourceKind === "screenshot" ? 80 : 44),
    ),
  );
  assert.ok(
    (
      await details.evaluateAll((items) => items.map((el) => el.getBoundingClientRect().height))
    ).every((height) => height >= 44),
    JSON.stringify(
      await details.evaluateAll((items) =>
        items.map((el) => ({
          height: el.getBoundingClientRect().height,
          computed: getComputedStyle(el).height,
          font: getComputedStyle(el).fontSize,
        })),
      ),
    ),
  );
  await sourceTab.locator("img").first().waitFor();
  assert.equal((await sourceTab.locator("img").first().boundingBox()).width, 28);
  const web = sourceTab.locator('[data-source-kind="web"]');
  const copy = web.getByRole("button", { name: "复制路径" });
  assert.equal(await copy.evaluate((el) => getComputedStyle(el).opacity), "0");
  await web.hover();
  await copy.click();
  assert.equal(
    await page.evaluate(() => window.__inventoryFixture.counters.copied),
    "https://example.com/page",
  );
  assert.equal(await sourceTab.getByText(/已附加到对话/).count(), 0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /关闭|Close/ })
    .click();
  await sourceTab.waitFor({ state: "hidden" });
  const column = fixture.locator("[data-tool-fixture-column]");
  assert.equal(await column.getByText("旧的思考", { exact: true }).count(), 0);
  await column.getByTestId("chat-reasoning-trigger").waitFor({ state: "hidden" });
  await column
    .locator('[data-tool-layout-variant="operations"]')
    .first()
    .getByRole("button", { name: "展开工具详情", exact: true })
    .first()
    .click();
  const appRow = column
    .getByRole("button", { name: "展开工具详情", exact: true })
    .filter({ hasText: "列出应用 · 94 个（9 个运行中）" });
  await appRow.waitFor();
  assert.equal((await appRow.boundingBox()).height, 24);
  assert.equal(await appRow.getAttribute("aria-expanded"), "false");
  await appRow.press("Enter");
  await column.getByTestId("mcp-expanded-content").first().waitFor();
  const groupDetail = column.locator(".tool-detail-scroll").first();
  assert.ok((await groupDetail.boundingBox()).height <= 220);
  const nestedScroll = await groupDetail.evaluate(
    (el) =>
      [...el.querySelectorAll("*")].filter((child) => {
        const s = getComputedStyle(child);
        return (
          ["auto", "scroll"].includes(s.overflowY) && child.scrollHeight > child.clientHeight + 1
        );
      }).length,
  );
  assert.equal(nestedScroll, 0);
  assert.equal(
    await column.evaluate((el) => /\p{Extended_Pictographic}/u.test(el.innerText)),
    false,
  );
  const skill = column
    .getByRole("button", { name: "展开工具详情", exact: true })
    .filter({ hasText: "技能" });
  assert.equal(await skill.getAttribute("aria-expanded"), "false");
  assert.match(await skill.innerText(), /技能\s*computer-use/);
  await page.evaluate(() => window.__inventoryFixture.render({ scope: "other-session" }));
  await summary.getByRole("button").click();
  await column
    .locator('[data-tool-layout-variant="operations"]')
    .first()
    .getByRole("button", { name: "展开工具详情", exact: true })
    .first()
    .click();
  await appRow.waitFor();
  assert.equal(await appRow.getAttribute("aria-expanded"), "false");
  assert.equal(await inventory.locator("[data-inventory-item]").count(), 0);
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.preview), 0);
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  await sourceTab.locator("[data-source-web-search]").click();
  await sourceTab.locator('[data-source-kind="web"] button').first().click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.browser), 1);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    window.__inventoryFixture.counters.failed = true;
    window.__inventoryFixture.render({ hasOlder: true });
  });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const retry = page
    .getByRole("dialog")
    .getByRole("button", { name: "加载失败，点击重试", exact: true });
  await retry.waitFor();
  await page.evaluate(() => {
    window.__inventoryFixture.counters.failed = false;
  });
  await retry.click();
  await retry.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.load), 2);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    window.__inventoryFixture.counters.hold = true;
  });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  const loading = inventory.getByRole("button", { name: "正在加载", exact: true });
  await loading.waitFor();
  assert.equal(await loading.isDisabled(), true);
  await page.evaluate(() => {
    window.__inventoryFixture.counters.finish();
    window.__inventoryFixture.counters.hold = false;
  });
  await loading.waitFor({ state: "hidden" });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await inventory.locator("[data-source-kind]").count(), 2);

  await page.evaluate(() => {
    window.__inventoryFixture.counters.failed = true;
    window.__inventoryFixture.render({ hasOlder: true });
  });
  await inventory.getByRole("button", { name: "查看全部", exact: true }).click();
  await retry.waitFor();
  await page.evaluate(() => {
    window.__inventoryFixture.counters.failed = false;
    window.__inventoryFixture.render({ hasOlder: false });
  });
  await retry.click();
  await retry.waitFor({ state: "hidden" });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await inventory.locator("[data-source-kind]").count(), 2);
  await page.evaluate(() => window.__inventoryFixture.render({ empty: true, hasOlder: false }));
  await inventory.getByText("暂无可用信息", { exact: true }).waitFor();
  assert.equal(await inventory.getByText("Sources", { exact: true }).count(), 0);
  assert.equal(
    await inventory.getByRole("button", { name: "暂无可用信息", exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.create), 0);
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.preview), 0);
  for (const theme of ["mycode-light", "mycode-dark"])
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((theme) => {
        window.__inventoryFixture.applyTheme(theme);
        window.__inventoryFixture.render({ empty: false });
      }, theme);
      await inventory.getByRole("heading", { name: "mycode", exact: true }).waitFor();
      assert.equal(await fixture.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: join(output, `inventory-tools-${theme}-${width}.png`) });
    }
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    navigator.clipboard.writeText = f.originalClipboardWrite;
    f.root.unmount();
    f.host.remove();
  });
}
