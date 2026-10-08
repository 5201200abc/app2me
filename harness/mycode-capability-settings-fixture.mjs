export async function mountCapabilitySettingsFixture(cwd) {
  const { React, createRoot } = window.__fixtureBootstrap;
  const h = React.createElement;
  const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
  const { ComputerUseSection } = await load("settings/ComputerUseSection.tsx");
  const { BrowserSettingsSection } = await load("settings/BrowserSettingsSection.tsx");
  const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
  const { PlatformProvider } = await load("hooks/usePlatform.tsx");
  const { ServiceProvider } = await load("hooks/useServices.tsx");
  const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
  const { usePluginManagementStore } = await load("store/pluginManagementStore.ts");
  const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
  const { useCuaComposerEntry } = await load("hooks/useCuaComposerEntry.ts");
  const { getCuaPermissionStatusSnapshot, cuaPermissionStatusKey } = await load(
    "lib/cuaPermissionStatusStore.ts",
  );
  const { applyTheme } = await load("useTheme.ts");
  const shared = await import(`/@fs${cwd}/packages/shared/src/index.ts`);
  const cuaId = shared.MYCODE_CUA_OFFICIAL_PLUGIN_ID;
  const browserId = "browser-use@mycode-plugins-official";
  const host = document.createElement("div");
  host.id = "capability-settings-fixture";
  host.className = "settings-compact";
  host.style.cssText =
    "position:fixed;inset:0;z-index:40;overflow:auto;padding:24px;background:var(--color-background);color:var(--color-foreground)";
  document.body.append(host);
  const root = createRoot(host);
  const state = { sequence: 0 };
  const granted = () => ({
    accessibility: "granted",
    screenRecording: "granted",
    accessibilityProbeOk: false,
    screenCaptureProbeOk: false,
  });
  const plugins = () => [
    { id: cuaId, enabled: state.enabled },
    { id: browserId, enabled: state.browserEnabled },
  ];
  const pluginService = {
    listPlugins: async () => ({ plugins: plugins(), diagnostics: [] }),
    getPluginsOverview: async () => ({
      marketplaces: [],
      availablePlugins: [],
      installedPlugins: [],
      restorableBuiltins: [],
      diagnostics: [],
    }),
    setPluginEnabled: async (input) => {
      state.calls.push({ action: "plugin", ...input });
      if (state.failPlugin) throw Error("fixture plugin save failed");
      if (input.pluginId === cuaId) state.enabled = input.enabled;
      else state.browserEnabled = input.enabled;
      return { enabled: input.enabled, plugin: plugins().find((p) => p.id === input.pluginId) };
    },
  };
  const services = {
    pluginManagementService: pluginService,
    mycodeSessionService: { closeSession: async () => {} },
    settingService: {
      get: async () => {
        state.settingsReads++;
        return { computerUseComposerEntryHidden: true };
      },
    },
    cuaPermissionService: {
      getStatus: async (path) => {
        state.calls.push({ action: "status", path });
        if (state.failStatus) throw Error("fixture status unavailable");
        return { available: true, ...state.permissions };
      },
      restartHelper: async (path, identity, options) => {
        state.calls.push({ action: "restart", path, identity, options });
        return state.failRestart ? { ok: false, reason: "fixture restart failed" } : { ok: true };
      },
    },
  };
  const platform = {
    executeDesktopCommand: async () => ({
      kind: state.belowFloor ? "macos-below-minimum" : "supported",
      minimumMacOs: "12.0",
      currentMacOs: "11.0",
    }),
    openCuaPermissionOnboarding: async (input) => {
      state.calls.push({ action: "onboarding", ...input });
      if (state.failOnboarding) throw Error("fixture onboarding failed");
      return new Promise((resolve) => {
        state.finish = resolve;
      });
    },
    cancelCuaPermissionOnboarding: (operationId) =>
      state.calls.push({ action: "cancel", operationId }),
    importChromeBrowserData: async () => {
      state.calls.push({ action: "import" });
      return {
        success: true,
        cookies: { imported: 0, skipped: 0, failed: 0 },
        localStorage: {
          originsImported: 0,
          entriesImported: 0,
          originsSkipped: 0,
          originsFailed: 0,
        },
        issues: [],
      };
    },
    clearEmbeddedBrowserData: async (mode) => {
      state.calls.push({ action: "clear", mode });
      return { success: true };
    },
  };
  useRemoteWorkspaceSessionStore.setState({ baseServices: services });
  const EntryProbe = () =>
    h("output", {
      "data-entry-visible": useCuaComposerEntry({ workspacePath: state.path }).view.visible,
    });
  const render = (options = {}) => {
    Object.assign(state, options);
    root.render(
      h(
        MyCodeIntlProvider,
        { key: state.locale, initialLocale: state.locale },
        h(
          PlatformProvider,
          { platform },
          h(
            ServiceProvider,
            { services },
            h(
              TabStoreProvider,
              null,
              h(
                "div",
                { style: { maxWidth: "900px", margin: "auto" } },
                h(
                  "h2",
                  { className: "mb-4 text-ui-base font-normal" },
                  state.locale === "en-US" ? "Control" : "控制",
                ),
                h(ComputerUseSection, {
                  key: state.mountKey,
                  isDesktop: true,
                  isMacDesktop: !state.windows,
                  isWindowsDesktop: state.windows,
                  workspacePath: state.path,
                  workspaceIdentity: state.identity,
                  remoteSessionId: state.remote ? "remote-fixture" : null,
                }),
                state.probe ? h(EntryProbe) : null,
                state.browser
                  ? h(
                      "section",
                      { "data-browser-fixture": "", className: "mt-8" },
                      h(
                        "h2",
                        { className: "mb-4 text-ui-base font-normal" },
                        state.locale === "en-US" ? "Browser" : "浏览器",
                      ),
                      h(BrowserSettingsSection, {
                        key: state.mountKey,
                        isDesktop: true,
                        isWindowsDesktop: state.windows,
                        workspacePath: state.path,
                      }),
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
    );
  };
  const configure = (options = {}) => {
    state.sequence++;
    Object.assign(
      state,
      {
        permissions: granted(),
        enabled: false,
        browserEnabled: false,
        locale: "zh-CN",
        windows: false,
        browser: false,
        remote: false,
        belowFloor: false,
        failStatus: false,
        failPlugin: false,
        failOnboarding: false,
        failRestart: false,
        probe: false,
        settingsReads: 0,
        calls: [],
        finish: null,
        path: `/fixture/control-${state.sequence}`,
        identity: undefined,
        mountKey: state.sequence,
      },
      options,
    );
    usePluginManagementStore.setState({
      plugins: plugins(),
      workspacePath: state.path,
      workspaceIdentity: null,
      configScope: null,
      togglingPluginId: null,
      loading: false,
      error: null,
    });
    render();
  };
  window.__capabilityFixture = {
    state,
    configure,
    render,
    granted,
    applyTheme,
    snapshot: () =>
      getCuaPermissionStatusSnapshot(cuaPermissionStatusKey(state.path, state.identity)),
    complete: (permissions = granted(), result = {}) => {
      state.permissions = permissions;
      state.finish({
        success: true,
        returnedFromSettings: true,
        sessionId: "fixture-permission",
        ...result,
      });
    },
    unmountSection: () => root.render(null),
  };
  configure();
}
