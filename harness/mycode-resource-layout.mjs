import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountFooterBarFixture } from "./mycode-footer-bar-fixture.mjs";

export async function verifyResourceControls(page, output, app) {
  await mountFooterBarFixture(page);
  await page.evaluate(async () => {
    const f = window.__inventoryFixture,
      h = f.h;
    const { NewTaskButtonGroup } = await f.load("NewTaskButtonGroup.tsx");
    const { Button } = await f.load("components/ui/button.tsx");
    const { CalendarClock, Blocks } = await f.load("components/icons/tabler.tsx");
    const { ConversationInventory } = await f.load("v4/ConversationInventory.tsx");
    const { buildConversationInventory } = await f.load("v4/conversationInventoryModel.ts");
    const font = await f.load("lib/uiFontSize.ts");
    font.applyUiFontSizePx(16);
    f.render({
      onlyExtra: true,
      empty: true,
      extra: h(
        "div",
        {
          "data-resource-controls": "",
          className: "conversation-reference-surface flex flex-col gap-4",
        },
        h(
          "aside",
          { className: "workspace-sidebar", style: { width: "100%" } },
          h(
            "div",
            { "data-sidebar-primary-actions": "", className: "flex flex-col" },
            h(NewTaskButtonGroup, { onCreateTask() {} }),
            ...[
              [CalendarClock, "自动化"],
              [Blocks, "插件"],
            ].map(([Icon, label]) =>
              h(
                Button,
                {
                  key: label,
                  variant: "ghost",
                  size: "lg",
                  className: "w-full justify-start",
                  "data-icon": "inline-start",
                },
                h(Icon),
                label,
              ),
            ),
          ),
        ),
        h(
          "aside",
          { "data-testid": "chat-summary-panel", style: { width: 280, maxWidth: "100%" } },
          h(ConversationInventory, {
            model: buildConversationInventory([], "/fixture/default"),
            context: { workspacePath: "/fixture/default", sessionId: "empty", logEpoch: "1" },
            rows: [],
            hasOlder: false,
            onLoadAll: async () => ({ status: "hydrated", logEpoch: "1" }),
            onLocate() {},
          }),
        ),
        h(window.__footerBarFixture.Bar),
      ),
    });
  });
  const metrics = [];
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const zoom of [1, 2])
      for (const width of [390, 1100]) {
        await app.evaluate(
          ({ BrowserWindow }, { width, zoom }) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setMinimumSize(1, 1);
            win.webContents.setZoomFactor(zoom);
            win.setContentSize(width * zoom, 900 * zoom);
          },
          { width, zoom },
        );
        await page.waitForFunction((width) => Math.abs(window.innerWidth - width) <= 1, width);
        const layout = await page.locator("[data-resource-controls]").evaluate((root) => {
          const rect = (e) => e.getBoundingClientRect(),
            empty = root.querySelector("[data-inventory-empty]");
          const range = document.createRange();
          range.selectNodeContents(empty);
          const text = range.getBoundingClientRect(),
            box = rect(empty);
          const actions = [...root.querySelector("[data-sidebar-primary-actions]").children].map(
            (el) => ({
              height: rect(el).height,
              font: getComputedStyle(el.querySelector("div") ?? el).fontSize,
              icon: rect(el.querySelector("svg")).width,
            }),
          );
          const submit = root.querySelector("[data-composer-submit-controls]"),
            permission = submit.firstElementChild,
            send = root.querySelector("[data-testid=v4-composer-send]");
          return {
            width: window.innerWidth,
            overflow: root.scrollWidth > root.clientWidth + 1,
            emptyOffset: Math.abs(text.x + text.width / 2 - box.x - box.width / 2),
            actions,
            gap: rect(send).left - rect(permission).right,
            expectedGap: parseFloat(getComputedStyle(submit).columnGap),
            centerOffset: Math.abs(
              rect(send).y +
                rect(send).height / 2 -
                rect(permission).y -
                rect(permission).height / 2,
            ),
          };
        });
        assert.equal(layout.overflow, false);
        assert.ok(layout.emptyOffset < 1);
        assert.ok(layout.centerOffset < 1);
        assert.ok(layout.gap >= layout.expectedGap - 1);
        assert.ok(layout.expectedGap > 12);
        for (const action of layout.actions) {
          assert.equal(action.font, "16px");
          assert.ok(action.icon > 18 && action.icon < 20);
          assert.ok(action.height > 33 && action.height < 35);
        }
        metrics.push({ theme, zoom, ...layout });
        const cdp = await page.context().newCDPSession(page);
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        await cdp.detach();
        await writeFile(
          join(output, `resource-controls-${theme}-${width}-${zoom}x.png`),
          Buffer.from(shot.data, "base64"),
        );
      }
  }
  await writeFile(join(output, "resource-controls-metrics.json"), JSON.stringify(metrics, null, 2));
  return { passed: true, scenarios: metrics.length };
}

export async function verifyResourceLayoutInteractions(page, output) {
  await page.evaluate(() => {
    const f = window.__pluginCopyFixture;
    f.pluginStore.setState({ plugins: f.fixturePlugins });
  });
  const settings = page.getByTestId("settings-page");
  const header = settings.locator("[data-settings-resource-page-header]");
  const search = settings.getByTestId("plugin-settings-search");
  const tab = (name) => settings.getByRole("tab", { name, exact: true });
  await search.fill("__no_matching_resource__");
  await settings.getByText("当前范围尚未安装插件。", { exact: true }).waitFor();
  await header.getByRole("button", { name: "刷新", exact: true }).click();
  assert.ok(await page.evaluate(() => window.__pluginCopyFixture.refreshCalls > 0));
  await header.getByTestId("plugin-settings-add").click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("Escape");
  await search.fill("");
  await tab("MCP").click();
  await settings.locator('[data-mcp-plugin-group="servers"]').waitFor();
  await search.fill("__no_matching_resource__");
  await header.getByRole("button", { name: "新建", exact: true }).click();
  await settings.getByText("新建 MCP 服务器", { exact: true }).first().waitFor();
  await settings.getByRole("button", { name: "取消", exact: true }).click();

  // 个人安装资源不能随内置展示一起被移除，原开关必须仍然可达。
  await page.evaluate(() => {
    const f = window.__pluginCopyFixture;
    f.fixturePlugins = [
      ...f.fixturePlugins,
      {
        ...f.fixturePlugins[0],
        id: "fixture-personal-plugin",
        name: "Fixture personal plugin",
        source: "local",
        hostMcpServerNames: [],
        mcpServerNames: ["fixture_personal_server"],
      },
    ];
    f.pluginStore.setState({ plugins: f.fixturePlugins });
  });
  await tab("插件").click();
  await settings
    .locator('[data-testid="plugin-settings-plugin-row"][data-plugin-id="fixture-personal-plugin"]')
    .waitFor();
  assert.equal(
    await settings
      .locator(
        '[data-testid="plugin-settings-enabled-switch"][data-plugin-id="fixture-personal-plugin"]',
      )
      .getAttribute("aria-checked"),
    "true",
  );
  await tab("MCP").click();
  await search.fill("");
  await settings.getByText("fixture_personal_server", { exact: true }).waitFor();
  assert.equal(
    await settings
      .locator('[data-mcp-plugin-group="servers"] [data-testid$="-cua_driver"]')
      .count(),
    1,
  );
  await header.getByRole("button", { name: /更多/ }).click();
  await page.getByRole("menuitem", { name: /导入/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await search.fill("");
  await settings.locator('[data-mcp-plugin-group="servers"] [data-testid$="-node_repl"]').waitFor();
  await writeFile(
    join(output, "resource-runtime-facts.json"),
    JSON.stringify(
      await page.evaluate(() => ({
        plugins: window.__pluginCopyFixture.pluginStore.getState().plugins,
        installed: window.__pluginCopyFixture.pluginStore.getState().installedPlugins,
        groups: [...document.querySelectorAll("[data-mcp-plugin-group]")].map((el) => ({
          group: el.getAttribute("data-mcp-plugin-group"),
          text: el.textContent,
        })),
      })),
      null,
      2,
    ),
  );
  assert.equal(
    await settings.locator('[data-mcp-plugin-group="servers"] [data-testid$="-node_repl"]').count(),
    1,
  );
  assert.equal(
    await settings
      .locator('[data-mcp-plugin-group="servers"] [data-testid$="-cua_driver"]')
      .count(),
    1,
  );
  assert.ok(
    await page.evaluate(() =>
      window.__pluginCopyFixture.pluginStore.getState().plugins.every((p) => p.enabled),
    ),
  );
  await tab("子智能体").click();
  await header.waitFor();
  await settings.getByText("Worker", { exact: true }).waitFor();
  await settings.getByText("Searcher", { exact: true }).waitFor();
  assert.equal(await settings.getByText("已安装", { exact: true }).count(), 0);
  assert.equal(await settings.getByText("没有找到子智能体", { exact: true }).count(), 0);
  await header.getByRole("button", { name: "新建", exact: true }).click();
  await settings.getByRole("button", { name: "取消", exact: true }).waitFor();
  await settings.getByRole("button", { name: "取消", exact: true }).click();

  const metrics = [];
  for (const theme of ["theme-mycode-dark", "theme-mycode-light"]) {
    await page.evaluate((theme) => {
      document.documentElement.classList.remove("theme-mycode-dark", "theme-mycode-light");
      document.documentElement.classList.add(theme);
    }, theme);
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of ["插件", "MCP", "技能", "子智能体"]) {
        await tab(name).click();
        await header.waitFor();
        assert.equal(await header.getByRole("heading", { name: "插件", exact: true }).count(), 1);
        await header
          .getByText("启用或停用已安装的插件。插件可打包技能、命令、Hooks 和 MCP 服务器。", {
            exact: true,
          })
          .waitFor();
        const layout = await header.evaluate((root) => {
          const box = root.getBoundingClientRect();
          const actions = root
            .querySelector("[data-settings-resource-page-actions]")
            .getBoundingClientRect();
          const input = root.querySelector("input").getBoundingClientRect();
          const title = root.querySelector("h3").getBoundingClientRect();
          return {
            overflow: root.scrollWidth > root.clientWidth + 1,
            actionsBelowSearch: actions.bottom > input.top + 1,
            titleOutside: title.left < box.left - 1 || title.right > box.right + 1,
            titleSize: getComputedStyle(root.querySelector("h3")).fontSize,
          };
        });
        assert.equal(layout.overflow, false, `${name} ${width}: overflow`);
        assert.equal(layout.actionsBelowSearch, false, `${name}: action/search rows overlap`);
        assert.equal(layout.titleOutside, false);
        metrics.push({ theme, width, name, ...layout });
        await page.screenshot({
          path: join(output, `resource-layout-${theme}-${width}-${name}.png`),
        });
      }
    }
  }
  await writeFile(join(output, "resource-layout-metrics.json"), JSON.stringify(metrics, null, 2));
}
