import assert from "node:assert/strict";
import { join } from "node:path";
import { verifyMemorySwitch } from "./mycode-composer-polish.mjs";
import { verifyBuiltinDisplayNames } from "./mycode-computer-memory-subagents.mjs";

export async function verifySettingsGroups(page, output) {
  const settings = page.getByTestId("settings-page");
  const nav = (id) => settings.getByTestId(`settings-section-nav-${id}`);
  for (const [id, label, sections] of [
    ["basics", "Basic", ["general", "appearance", "modelProvider", "shortcuts"]],
    ["integrations", "Integrations", ["plugin", "computerUse", "browser"]],
    ["coding", "Coding", ["hooks"]],
    ["tools", "Tools", ["commands"]],
  ]) {
    const group = settings.locator(`[aria-labelledby="settings-sidebar-group-${id}"]`);
    assert.equal(await settings.locator(`#settings-sidebar-group-${id}`).innerText(), label);
    assert.deepEqual(
      await group
        .locator('[data-testid^="settings-section-nav-"]')
        .evaluateAll((items) =>
          items.map((item) =>
            item.getAttribute("data-testid").replace("settings-section-nav-", ""),
          ),
        ),
      sections,
    );
  }
  assert.equal(await nav("memory").count(), 0);
  assert.equal(await nav("subagents").count(), 0);
  assert.equal(await nav("browser").innerText(), "浏览器");

  await nav("general").click();
  const memory = settings.locator("[data-general-settings-memory]");
  await memory.getByRole("switch", { name: "记忆", exact: true }).waitFor();
  assert.equal(await memory.evaluate((el) => el.parentElement.lastElementChild === el), true);
  await verifyMemorySwitch(settings);
  const toggle = memory.getByRole("switch", { name: "记忆", exact: true });
  const before = await toggle.getAttribute("aria-checked");
  if (before === "false") await toggle.press("Space");
  await memory.getByText("暂无已保存的工作区记忆", { exact: true }).waitFor();
  await memory.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "settings-general-memory-last.png") });
  if (before === "false") await toggle.press("Space");

  await nav("plugin").click();
  assert.deepEqual(await settings.getByRole("tab").allTextContents(), [
    "插件",
    "MCP",
    "技能",
    "子智能体",
  ]);
  await settings.getByRole("tab", { name: "子智能体", exact: true }).click();
  await settings.getByTestId("subagent-built-in-model-trigger-general-purpose").waitFor();
  assert.equal(await settings.getByPlaceholder("搜索子智能体...", { exact: true }).count(), 1);
  assert.equal(await settings.locator("[data-plugin-scope-trigger]:visible").count(), 1);
  await verifyBuiltinDisplayNames(settings);
  await settings
    .locator("[data-settings-resource-actions]")
    .getByRole("button", { name: "刷新", exact: true })
    .click();
  await settings.getByText("Worker", { exact: true }).waitFor();
  const openForm = () =>
    settings
      .locator("[data-settings-resource-actions]")
      .getByRole("button", { name: "新建", exact: true })
      .click();
  await openForm();
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await settings.getByRole("tab", { name: "子智能体", exact: true }).waitFor();

  for (const theme of ["浅色", "深色"]) {
    await nav("appearance").click();
    await settings.getByRole("combobox").first().click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    await nav("plugin").click();
    await settings.getByRole("tab", { name: "子智能体", exact: true }).click();
    await settings.getByText("Worker", { exact: true }).waitFor();
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await settings.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      assert.ok(geometry.scroll <= geometry.width + 1, `${theme} ${width} overflow`);
      assert.equal(
        await settings
          .getByRole("tab", { name: "子智能体", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.screenshot({ path: join(output, `settings-subagents-tab-${theme}-${width}.png`) });
      await nav("general").click();
      await memory.getByRole("switch", { name: "记忆", exact: true }).waitFor();
      assert.equal(await memory.evaluate((el) => el.parentElement.lastElementChild === el), true);
      const generalGeometry = await settings.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      assert.ok(
        generalGeometry.scroll <= generalGeometry.width + 1,
        `${theme} ${width} general overflow`,
      );
      await memory.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `settings-memory-last-${theme}-${width}.png`) });
      await nav("plugin").click();
      await settings.getByRole("tab", { name: "子智能体", exact: true }).click();
      await settings.getByText("Worker", { exact: true }).waitFor();
    }
  }

  for (const name of ["插件", "MCP", "技能", "子智能体"]) {
    const tab = settings.getByRole("tab", { name, exact: true });
    await tab.click();
    assert.equal(
      await settings.getByRole("tab", { name, exact: true }).getAttribute("aria-selected"),
      "true",
    );
  }
  await settings.getByText("Worker", { exact: true }).waitFor();
  await openForm();
  await settings.getByTestId("chat-model-select-trigger").click();
  await page.getByRole("menuitem", { name: "管理模型", exact: true }).click();
  await settings.getByTestId("model-provider-section").waitFor();

  // 已挂载导航沿用原事件接口，验证历史入口实际落到新位置。
  const intent = (section) =>
    page.evaluate(
      async ({ cwd, section }) => {
        const { setPendingSettingsSectionIntent } = await import(
          `/@fs/${cwd}/packages/ui/src/lib/settingsNavigation.ts`
        );
        setPendingSettingsSectionIntent(section);
      },
      { cwd: process.cwd(), section },
    );
  await intent("subagents");
  await settings.getByText("Worker", { exact: true }).waitFor();
  assert.equal(
    await settings
      .getByRole("tab", { name: "子智能体", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await intent("memory");
  await memory.getByRole("switch", { name: "记忆", exact: true }).waitFor();
  assert.equal(await nav("general").getAttribute("aria-current"), "page");
  for (const id of ["browser", "computerUse", "hooks", "commands"]) {
    await nav(id).click();
    assert.equal(await nav(id).getAttribute("aria-current"), "page");
  }
  await page.screenshot({ path: join(output, "settings-new-groups.png") });
}
