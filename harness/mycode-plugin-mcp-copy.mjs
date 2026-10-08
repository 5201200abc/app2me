import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { verifyResourceLayoutInteractions } from "./mycode-resource-layout.mjs";

export async function verifyPluginMcpCopy(page, output) {
  const settings = page.getByTestId("settings-page");
  await settings.locator("[data-settings-resource-page-header]").waitFor();
  await page.evaluate(async (cwd) => {
    // 复用真实组件的模块 URL，避免 .js/.ts URL 分裂出不相连的 Zustand store。
    const pluginSource = await fetch(
      `/@fs/${cwd}/packages/ui/src/settings/PluginsSection.tsx`,
    ).then((response) => response.text());
    const mcpSource = await fetch(
      `/@fs/${cwd}/packages/ui/src/settings/McpSettingsSection.tsx`,
    ).then((response) => response.text());
    const pluginStoreUrl = pluginSource.match(
      /import\s*\{\s*usePluginManagementStore\s*\}\s*from\s*["']([^"']+)["']/,
    )?.[1];
    const mcpStoreUrl = mcpSource.match(
      /import\s*\{\s*useMcpStore\s*\}\s*from\s*["']([^"']+)["']/,
    )?.[1];
    const { usePluginManagementStore } = await import(pluginStoreUrl);
    const { useMcpStore } = await import(mcpStoreUrl);
    const state = usePluginManagementStore.getState();
    const mcp = useMcpStore.getState();
    window.__pluginCopyFixture = {
      pluginStore: usePluginManagementStore,
      mcpStore: useMcpStore,
      plugins: state.plugins,
      availablePlugins: state.availablePlugins,
      installedPlugins: state.installedPlugins,
      initialize: state.initialize,
      ensureLoadedForWorkspace: mcp.ensureLoadedForWorkspace,
      currentProjectPath: mcp.currentProjectPath,
      currentWorkspaceIdentity: mcp.currentWorkspaceIdentity,
      isConfigLoaded: mcp.isConfigLoaded,
      statusSnapshots: mcp.statusSnapshots,
    };
    const plugins = ["node-repl-host", "browser-use", "computer-use"].map((name) => ({
      id: `${name}@mycode-plugins-official`,
      name,
      description: "English manifest description",
      marketplace: "mycode-plugins-official",
      source: "official",
      enabled: true,
      rootPath: `/fixture/${name}`,
      skillRootCount: 0,
      commandRootCount: 0,
      mcpServerNames: [],
      hostMcpServerNames:
        name === "browser-use" ? ["node_repl"] : name === "computer-use" ? ["cua_driver"] : [],
    }));
    window.__pluginCopyFixture.fixturePlugins = plugins;
    // 真实列表使用隔离的协议夹具；旧桌面 CLI bundle 可能没有物化 computer-use。
    // 禁止初始化和配置加载，避免向 Host 写入夹具或启动系统能力。
    useMcpStore.setState({
      isConfigLoaded: false,
      statusSnapshots: {},
      ensureLoadedForWorkspace: async (workspacePath, _service, workspaceIdentity) => {
        useMcpStore.setState({
          currentProjectPath: workspacePath,
          currentWorkspaceIdentity: workspaceIdentity ?? null,
        });
        return true;
      },
    });
    usePluginManagementStore.setState({
      initialize: async () => {
        window.__pluginCopyFixture.refreshCalls =
          (window.__pluginCopyFixture.refreshCalls ?? 0) + 1;
      },
      installedPlugins: [],
      plugins,
      availablePlugins: plugins.map((plugin) => ({
        ...plugin,
        installed: true,
        listing: { descriptionI18n: { "zh-CN": "旧缓存说明" } },
      })),
    });
    // 旧 CLI bundle 的后台 overview 缺少 computer-use 包，会覆盖隔离夹具；固定测试事实，
    // 不拦截 UI 回调，也不对真实 Host 写入安装或启停配置。
    window.__pluginCopyFixture.unsubscribe = usePluginManagementStore.subscribe((next) => {
      const fixture = window.__pluginCopyFixture;
      if (next.plugins !== fixture.fixturePlugins) {
        usePluginManagementStore.setState({
          plugins: fixture.fixturePlugins,
          installedPlugins: [],
        });
      }
    });
  }, process.cwd());
  try {
    await verifyOfficialPluginCopy(settings);
    await page.screenshot({ path: join(output, "official-plugin-copy.png") });
    await verifyHostMcpCopy(page, output);
    await verifyResourceLayoutInteractions(page, output);
  } finally {
    await page.evaluate(() => {
      const fixture = window.__pluginCopyFixture;
      fixture.unsubscribe();
      fixture.pluginStore.setState({
        plugins: fixture.plugins,
        availablePlugins: fixture.availablePlugins,
        installedPlugins: fixture.installedPlugins,
        initialize: fixture.initialize,
      });
      fixture.mcpStore.setState({
        ensureLoadedForWorkspace: fixture.ensureLoadedForWorkspace,
        currentProjectPath: fixture.currentProjectPath,
        currentWorkspaceIdentity: fixture.currentWorkspaceIdentity,
        isConfigLoaded: fixture.isConfigLoaded,
        statusSnapshots: fixture.statusSnapshots,
      });
      delete window.__pluginCopyFixture;
    });
  }
}

export async function verifyOfficialPluginCopy(settings) {
  // 内置能力仍保留在 store 中，插件设置只移除它们的展示。
  for (const name of ["node-repl-host", "browser-use", "computer-use"]) {
    assert.equal(
      await settings.locator(`[data-plugin-id="${name}@mycode-plugins-official"]`).count(),
      0,
    );
  }
  assert.equal(await settings.getByText("尚未安装插件", { exact: true }).count(), 0);
  await settings.getByRole("button", { name: "浏览插件", exact: true }).waitFor();
}

export async function verifyHostMcpCopy(page, output) {
  const settings = page.getByTestId("settings-page");
  const mcpTab = settings.getByRole("tab", { name: /^MCP/ });
  await mcpTab.focus();
  await mcpTab.press("Enter");
  assert.equal(await mcpTab.getAttribute("aria-selected"), "true");
  await page.evaluate(() => {
    const { pluginStore: usePluginManagementStore, mcpStore: useMcpStore } =
      window.__pluginCopyFixture;
    const plugins = usePluginManagementStore.getState().plugins;
    const mcpState = useMcpStore.getState();
    // 只投影两种宿主资源的中性状态；不保存插件开关或向运行时下发配置。
    window.__hostMcpCopyFixture = {
      plugins,
      pluginStore: usePluginManagementStore,
      mcpStore: useMcpStore,
      statusSnapshots: mcpState.statusSnapshots,
      isConfigLoaded: mcpState.isConfigLoaded,
    };
    useMcpStore.setState({ statusSnapshots: {}, isConfigLoaded: false });
    usePluginManagementStore.setState({
      plugins: plugins.map((plugin) =>
        plugin.id === "computer-use@mycode-plugins-official"
          ? { ...plugin, enabled: true }
          : plugin,
      ),
    });
  });
  try {
    for (const [server, text] of [
      [
        "node_repl",
        "该 MCP 服务器由 MyCode 自己提供，属于 browser-use 插件，运行时的身份由 MyCode 管理。",
      ],
      [
        "cua_driver",
        "该驱动由 MyCode 自己提供，属于 computer-use 插件，运行时的身份由 MyCode 管理。",
      ],
    ]) {
      const row = settings.locator(`[data-testid$="-${server}"]`);
      await row.getByText(text, { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await row.getAttribute("data-mcp-status"), "");
    }
    await settings
      .locator('[data-mcp-plugin-group="servers"]')
      .getByText("服务器", { exact: true })
      .waitFor();
    assert.equal(await settings.getByText("尚未安装 MCP 服务器", { exact: true }).count(), 0);
    await page.screenshot({ path: join(output, "host-mcp-copy.png") });
  } catch (error) {
    const debug = await settings.evaluate((root) => {
      const row = root.querySelector('[data-testid="plugin-mcp-server-row-node_repl"]');
      const ancestors = [];
      for (let el = row; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        ancestors.push({
          tag: el.tagName,
          state: el.getAttribute("data-state"),
          display: style.display,
          height: el.getBoundingClientRect().height,
          hidden: el.hidden,
        });
      }
      return {
        ancestors,
        tabs: [...root.querySelectorAll('[role="tab"]')].map((tab) => ({
          text: tab.textContent,
          selected: tab.getAttribute("aria-selected"),
        })),
      };
    });
    await writeFile(join(output, "mcp-copy-debug.json"), JSON.stringify(debug, null, 2));
    await page.screenshot({ path: join(output, "mcp-copy-failure.png") });
    throw error;
  } finally {
    await page.evaluate(() => {
      const fixture = window.__hostMcpCopyFixture;
      fixture.pluginStore.setState({ plugins: fixture.plugins });
      fixture.mcpStore.setState({
        statusSnapshots: fixture.statusSnapshots,
        isConfigLoaded: fixture.isConfigLoaded,
      });
      delete window.__hostMcpCopyFixture;
    });
    await settings.getByRole("tab", { name: /^插件/ }).click();
  }
}
