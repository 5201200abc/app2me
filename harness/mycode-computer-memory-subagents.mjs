import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyComputerControlCopy(page, output) {
  await page.evaluate(async (cwd) => {
    const resources = performance.getEntriesByType("resource").map((e) => e.name);
    const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(
      resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
    );
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const load = (path) => import("/@fs" + cwd + "/packages/ui/src/" + path);
    const { ComputerUseSection } = await load("settings/ComputerUseSection.tsx");
    const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
    const { PlatformProvider } = await load("hooks/usePlatform.tsx");
    const { ServiceProvider } = await load("hooks/useServices.tsx");
    const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
    const { usePluginManagementStore } = await load("store/pluginManagementStore.ts");
    const shared = await import("/@fs" + cwd + "/packages/shared/src/index.ts");
    const plugins = usePluginManagementStore.getState().plugins;
    // 只在隔离页面展示已启用夹具，不启动 Helper、修改系统授权或切换真实插件。
    usePluginManagementStore.setState({
      plugins: [{ id: shared.MYCODE_CUA_OFFICIAL_PLUGIN_ID, enabled: true }],
    });
    const host = document.createElement("div");
    host.id = "computer-copy-fixture";
    host.className = "settings-compact";
    host.style.cssText =
      "position:fixed;inset:0;z-index:50;overflow:auto;background:var(--color-background);padding:16px;color:var(--color-foreground)";
    document.body.append(host);
    const root = createRoot(host);
    const services = {
      ...useRemoteWorkspaceSessionStore.getState().baseServices,
      pluginManagementService: undefined,
      cuaPermissionService: undefined,
    };
    root.render(
      React.createElement(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        React.createElement(
          PlatformProvider,
          { platform: {} },
          React.createElement(
            ServiceProvider,
            { services },
            React.createElement(ComputerUseSection, {
              isDesktop: true,
              isMacDesktop: true,
              workspacePath: cwd,
            }),
          ),
        ),
      ),
    );
    window.__computerCopyFixture = { root, host, plugins, store: usePluginManagementStore };
  }, process.cwd());
  const fixture = page.locator("#computer-copy-fixture");
  try {
    await fixture
      .getByText("允许 AI 操作你的电脑；首次开启时需完成系统授权。", { exact: true })
      .waitFor();
    const toggle = fixture.getByRole("switch", { name: "计算机使用", exact: true });
    assert.equal(await fixture.getByRole("switch").count(), 1);
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    assert.equal(await toggle.isEnabled(), false);
    assert.equal(
      await fixture.getByText("屏幕录制 (Screen Recording)", { exact: true }).count(),
      0,
    );
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await fixture.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: join(output, "computer-copy-" + width + ".png") });
    }
  } finally {
    await page.evaluate(() => {
      const f = window.__computerCopyFixture;
      f.root.unmount();
      f.host.remove();
      f.store.setState({ plugins: f.plugins });
      delete window.__computerCopyFixture;
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}

export async function verifyBuiltinDisplayNames(settings) {
  const search = settings.getByPlaceholder("搜索子智能体...", { exact: true });
  for (const text of [
    "通用型，可研究复杂问题、搜索代码、执行多步骤任务，能使用全部工具。",
    "只读的搜索型，只能查看不能修改，适合同时朝多个方向大范围搜索，只开放 7 个工具。",
  ])
    await settings.getByText(text, { exact: true }).waitFor();
  for (const [name, key, other] of [
    ["Worker", "general-purpose", "Searcher"],
    ["Searcher", "Explore", "Worker"],
  ]) {
    await settings.getByText(name, { exact: true }).waitFor();
    await search.fill(name);
    await settings.getByText(name, { exact: true }).waitFor();
    assert.equal(await settings.getByText(other, { exact: true }).count(), 0);
    assert.equal(await settings.getByTestId("subagent-row-" + key).count(), 1);
    const control = settings.getByTestId("subagent-built-in-model-trigger-" + key);
    await control.getByRole("button").click();
    await settings.page().getByRole("menuitem", { name: "默认", exact: true }).waitFor();
    await settings.page().keyboard.press("Escape");
    await search.fill("");
  }
  await settings
    .getByText(
      "主 Agent 可以派出去单独处理子任务的助手，每个有自己的名称、可用工具和系统提示词（规定它角色和行为的说明）。",
      { exact: true },
    )
    .waitFor();
}
