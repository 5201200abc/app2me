export async function mountMyChatFixture(cwd) {
  const { React, createRoot } = await import(`/@fs${cwd}/harness/mychat-mode-bootstrap.ts`);
  const h = React.createElement;
  const load = (p) => import(`/@fs${cwd}/packages/ui/src/${p}`);
  const { default: MyChatWorkspace } = await load("mychat/MyChatWorkspace.tsx");
  const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
  const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
  const { StoreProvider, useMyCodeStore } = await load("store/StoreProvider.tsx");
  const { PlatformProvider } = await load("hooks/usePlatform.tsx");
  const { ServiceProvider } = await load("hooks/useServices.tsx");
  const { TooltipProvider } = await load("components/ui/tooltip.tsx");
  const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
  const { applyTheme } = await load("useTheme.ts");
  const { applyUiFontSizePx } = await load("lib/uiFontSize.ts");
  const { useMyChatApi } = await load("hooks/useMyChatApi.ts");
  document.getElementById("loading")?.remove();
  localStorage.setItem("mycode-interface-mode", "mychat");
  localStorage.setItem("mycode-theme", "mycode-dark");
  const host = document.createElement("div");
  host.id = "mychat-mode-fixture";
  host.style.cssText =
    "position:fixed;inset:0;z-index:40;background:var(--color-background);font-family:var(--font-sans)";
  document.body.append(host);
  const api = {
    call: window.__mychatCall,
    onEvent(listener) {
      const handler = (e) => listener(e.detail);
      window.addEventListener("mychat-fixture-event", handler);
      return {
        dispose() {
          window.removeEventListener("mychat-fixture-event", handler);
        },
      };
    },
  };
  const Fixture = () => {
    const mode = useMyCodeStore((s) => s.interfaceMode),
      theme = useMyCodeStore((s) => s.theme),
      font = useMyCodeStore((s) => s.uiFontSizePx);
    const setMode = useMyCodeStore((s) => s.setInterfaceMode),
      setTheme = useMyCodeStore((s) => s.setTheme),
      setFontSize = useMyCodeStore((s) => s.setUiFontSizePx);
    const api = useMyChatApi(mode === "mychat");
    window.__mychatFixture = { setMode, setTheme, setFontSize, api };
    React.useEffect(() => {
      applyTheme(theme);
      applyUiFontSizePx(font);
    }, [theme, font]);
    return h(
      React.Fragment,
      null,
      h(
        "span",
        { "data-fixture-host-font": "", style: { position: "absolute", visibility: "hidden" } },
        "Host",
      ),
      h(
        "div",
        { "data-fixture-mycode": "", style: { display: mode === "mycode" ? "block" : "none" } },
        "MyCode 原有界面",
      ),
      h(
        "div",
        {
          style: { position: "absolute", inset: 0, display: mode === "mychat" ? "block" : "none" },
        },
        h(MyChatWorkspace, {
          active: mode === "mychat",
          workspacePath: "/fixture/mycode",
          isDesktop: true,
        }),
      ),
    );
  };
  const base = useRemoteWorkspaceSessionStore.getState().baseServices ?? {};
  const terminalEvent = (kind, id) => (listener) => {
    const handler = (e) => {
      if (e.detail.id === id && e.detail.kind === kind) listener(e.detail.data);
    };
    window.addEventListener("mychat-terminal-event", handler);
    return {
      dispose() {
        window.removeEventListener("mychat-terminal-event", handler);
      },
    };
  };
  const terminalService = {
    create: (params) => window.__mychatTerminalCall("create", params),
    write: (params) => window.__mychatTerminalCall("write", params),
    resize: (params) => window.__mychatTerminalCall("resize", params),
    dispose: (params) => window.__mychatTerminalCall("dispose", params),
    onDynamicData: (id) => terminalEvent("Data", id),
    onDynamicExit: (id) => terminalEvent("Exit", id),
  };
  createRoot(host).render(
    h(
      MyCodeIntlProvider,
      { initialLocale: "zh-CN" },
      h(
        PlatformProvider,
        {
          platform: {
            name: "desktop",
            onNewTask() {
              return () => {};
            },
            selectDirectory: async () => null,
          },
        },
        h(
          ServiceProvider,
          { services: { ...base, myChatService: api, terminalService } },
          h(
            StoreProvider,
            {
              broadcastService: {
                send() {},
                onMessage() {
                  return () => {};
                },
              },
            },
            h(TabStoreProvider, null, h(TooltipProvider, null, h(Fixture))),
          ),
        ),
      ),
    ),
  );
}
