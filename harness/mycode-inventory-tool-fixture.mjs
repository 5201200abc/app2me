export async function mountInventoryToolFixture(cwd) {
  const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
  const rm = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
  const dm = await import(resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url)));
  const React = rm.default ?? rm,
    { createRoot } = dm.default ?? dm;
  const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
  const { ConversationStatusPanel } = await load("v4/ConversationStatusPanel.tsx");
  const { ConversationTurnGroup } = await load("v4/ConversationTurnGroup.tsx");
  const { buildConversationTurnRenderUnits } = await load("v4/conversationTurnRenderUnits.ts");
  const { buildConversationInventory } = await load("v4/conversationInventoryModel.ts");
  const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
  const { StoreProvider } = await load("store/StoreProvider.tsx");
  const { PlatformProvider } = await load("hooks/usePlatform.tsx");
  const { ServiceProvider } = await load("hooks/useServices.tsx");
  const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
  const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
  const { TooltipProvider } = await load("components/ui/tooltip.tsx");
  const { DEFAULT_CODE_PREVIEW_SETTINGS } = await load("lib/codePreviewSettings.ts");
  const { applyTheme } = await load("useTheme.ts");
  const host = document.createElement("div");
  host.id = "inventory-tool-fixture";
  host.style.cssText =
    "position:fixed;inset:0;z-index:40;overflow:auto;background:var(--color-background)";
  document.body.append(host);
  const root = createRoot(host);
  const h = React.createElement;
  const counters = {
    create: 0,
    add: 0,
    preview: 0,
    browser: 0,
    locate: 0,
    load: 0,
    failed: false,
    copied: "",
  };
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const now = Date.now();
  const base = (rowId) => ({ rowId, turnId: "fixture", createdAt: now, createdAtSeq: rowId });
  const mcp = (rowId, toolName, text) => ({
    ...base(rowId),
    kind: "toolCall",
    toolCallId: `mcp-${rowId}`,
    toolName: `mcp__cua__${toolName}`,
    inputText: "",
    input: {},
    status: "success",
    display: { kind: "mcp_tool", serverName: "cua_driver", toolName },
    output: { text },
  });
  const rows = [
    {
      ...base(1),
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: now - 5000,
      endedAt: now,
      fileChanges: { files: 1, additions: 12, deletions: 3 },
    },
    {
      ...base(2),
      kind: "userInput",
      origin: "realUser",
      text: "测试 ✅",
      attachments: [
        {
          ref: "attachment-1",
          fileName: "original-screen-one.png",
          mime: "image/png",
          bytes: 100,
        },
        {
          ref: "attachment-2",
          fileName: "original-screen-two.png",
          mime: "image/png",
          bytes: 100,
        },
      ],
    },
    { ...base(3), kind: "reasoning", state: "complete", text: "旧的思考" },
    { ...base(4), kind: "reasoning", state: "complete", text: "准备开始操作。" },
    { ...base(5), kind: "assistantText", state: "complete", text: "准备开始操作" },
    mcp(6, "check_permissions", "✅ 已授权"),
    mcp(
      7,
      "list_apps",
      `✅ Found 94 app(s): 9 running, 85 installed-not-running.\n${'{"application":"example"}\n'.repeat(80)}`,
    ),
    mcp(8, "click", "✅ 点击完成"),
    {
      ...base(9),
      kind: "toolCall",
      toolCallId: "skill",
      toolName: "Skill",
      inputText: "",
      status: "success",
      input: { skill: "computer-use:computer-use" },
      output: { text: "完整技能提示词。\n".repeat(80) },
    },
    {
      ...base(10),
      kind: "assistantText",
      state: "complete",
      text: "结果已完成 ✅。长文件名可以预览：[this-is-a-long-filename-created.html](/fixture/this-is-a-long-filename-created.html)。",
    },
    {
      ...base(11),
      kind: "toolCall",
      toolCallId: "web",
      toolName: "WebFetch",
      inputText: "",
      status: "success",
      input: { url: "https://example.com/page", title: "示例网页" },
      output: { text: "网页" },
    },
    {
      ...base(12),
      kind: "toolCall",
      toolCallId: "search",
      toolName: "WebSearch",
      inputText: "",
      status: "success",
      input: { query: "界面设计" },
      output: { text: "结果" },
    },
  ];
  let context = {
    workspacePath: "/fixture/mycode",
    sessionId: "inventory",
    logEpoch: "1",
    theme: "mycode-dark",
    codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
    messageStreamShowReasoning: true,
    messageStreamShowTodos: true,
    onOpenCodeViewer: () => counters.preview++,
    onOpenFileLink: () => counters.preview++,
    onOpenBrowserUrl: () => counters.browser++,
    readAttachment: async () => ({
      bytes: Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
      mediaType: "image/png",
    }),
  };
  const FixtureMain = ({ children, ...props }) =>
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
      h("main", props, children),
    );
  let platformOverrides = {};
  let sourceNameResolver;
  let empty = false,
    hasOlder = false;
  const render = (options) => {
    if (options?.sourceNameResolver) sourceNameResolver = options.sourceNameResolver;
    if (options?.context) context = { ...context, ...options.context };
    if (options?.platform) platformOverrides = { ...platformOverrides, ...options.platform };
    empty = options?.empty ?? empty;
    hasOlder = options?.hasOlder ?? hasOlder;
    if (options?.liveChanges)
      rows[0] = { ...rows[0], fileChanges: { ...options.liveChanges, state: "active" } };
    if (options?.thinking !== undefined)
      rows[3] = { ...rows[3], text: options.thinking ? "另一个独立推理过程" : "准备开始操作。" };
    if (options?.scope) context = { ...context, sessionId: options.scope };
    const facts = empty ? [] : rows;
    const model = buildConversationInventory(
      facts,
      context.workspacePath,
      undefined,
      sourceNameResolver,
    );
    const unit = buildConversationTurnRenderUnits(options?.workRows ?? rows)[0];
    unit.assistantHistoryDefaultOpen = true;
    root.render(
      h(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        h(
          PlatformProvider,
          {
            platform: {
              ...platformOverrides,
              saveFile: async () => {
                counters.create++;
                return { success: true, path: "/fixture/new.html" };
              },
            },
          },
          h(
            ServiceProvider,
            { services: useRemoteWorkspaceSessionStore.getState().baseServices ?? {} },
            h(
              TabStoreProvider,
              null,
              h(
                TooltipProvider,
                null,
                h(
                  FixtureMain,
                  {
                    className: "@container/conversation relative min-h-full p-6 text-foreground",
                  },
                  h(
                    "div",
                    {
                      "data-tool-fixture-column": "",
                      "data-fixture-session": context.sessionId,
                      className: "mx-auto max-w-[760px]",
                    },
                    options?.onlyExtra ? null : h(ConversationTurnGroup, { unit, context }),
                    options?.extra ?? null,
                  ),
                  options?.onlyExtra
                    ? null
                    : h(ConversationStatusPanel, {
                        workspacePath: context.workspacePath,
                        summaryPanelVariantOverride: "panel",
                        layoutMode: "inline",
                        showEmpty: true,
                        inventory: {
                          model,
                          context,
                          rows: facts,
                          hasOlder,
                          onLocate: () => counters.locate++,
                          onAddSource: () => counters.add++,
                          onLoadAll: async () => {
                            counters.load++;
                            if (counters.hold)
                              await new Promise((resolve) => {
                                counters.finish = resolve;
                              });
                            return {
                              status: counters.failed ? "retryable-failure" : "hydrated",
                              logEpoch: context.logEpoch,
                            };
                          },
                        },
                      }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };
  const originalClipboardWrite = navigator.clipboard.writeText;
  navigator.clipboard.writeText = async (text) => {
    counters.copied = text;
  };
  window.__inventoryFixture = {
    rows,
    png,
    root,
    host,
    render,
    counters,
    applyTheme,
    originalClipboardWrite,
    h,
    load,
  };
  render();
}
