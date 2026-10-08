// Visual fixture uses production components and an isolated Electron profile, never user data.
export async function mountReferenceConversation(cwd) {
  const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
  const rm = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
  const dm = await import(resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url)));
  const React = rm.default ?? rm,
    { createRoot } = dm.default ?? dm,
    h = React.createElement;
  const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
  const { ConversationTurnGroup } = await load("v4/ConversationTurnGroup.tsx");
  const { ConversationStatusPanel } = await load("v4/ConversationStatusPanel.tsx");
  const { buildConversationTurnRenderUnits } = await load("v4/conversationTurnRenderUnits.ts");
  const { buildConversationInventory } = await load("v4/conversationInventoryModel.ts");
  const { getConversationContentWidthClassName, getConversationStatusPanelOffsetClassName } =
    await load("v4/conversationLayout.ts");
  const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
  const { PlatformProvider } = await load("hooks/usePlatform.tsx");
  const { ServiceProvider } = await load("hooks/useServices.tsx");
  const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
  const { TooltipProvider } = await load("components/ui/tooltip.tsx");
  const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
  const { DEFAULT_CODE_PREVIEW_SETTINGS } = await load("lib/codePreviewSettings.ts");
  const { applyTheme } = await load("useTheme.ts");
  const { ConversationComposer } = await load("v4/ConversationComposer.tsx");
  const { AssistantPreviewCards } = await load("AssistantPreviewCards.tsx");
  const target = document.querySelector(".conversation-reference-surface");
  const composer = target.querySelector('[data-testid="v4-composer"]');
  let fiber = composer[Object.keys(composer).find((key) => key.startsWith("__reactFiber$"))];
  while (fiber && !fiber.memoizedProps?.composerDraft) fiber = fiber.return;
  if (!fiber) throw new Error("Production composer props not found");
  let platformFiber = fiber;
  while (platformFiber && !platformFiber.memoizedProps?.platform)
    platformFiber = platformFiber.return;
  if (!platformFiber) throw new Error("Production platform provider not found");
  const platform = platformFiber.memoizedProps.platform;
  const composerProps = {
    ...fiber.memoizedProps,
    centered: false,
    contextHeader: undefined,
    autoFocusEnabled: false,
    listenAddToChatEvents: false,
    snapshot: {
      inputRouting: { mode: "startNow" },
      control: { phase: "idle", canStop: false },
      config: { followupMode: "guide" },
      rows: { totalCount: 8 },
      backgroundWorks: [],
      usage: { contextWindow: { usedTokens: 32000, maxTokens: 128000 } },
    },
  };
  const host = document.createElement("div");
  host.id = "reference-conversation-fixture";
  host.className =
    "conversation-reference-surface @container/conversation absolute inset-0 z-30 overflow-hidden";
  target.append(host);
  const root = createRoot(host);
  const counts = { browser: 0, preview: 0, add: 0, locate: 0 };
  const startedAt = Date.now() - 682000;
  const base = (rowId, turnId = "first") => ({
    rowId,
    turnId,
    createdAt: startedAt + rowId * 1000,
    createdAtSeq: rowId,
  });
  const firstText = `**结论：目前没找到能确认属于该抖音号的其他平台账号，也没有找到可确认由它发布的视频。** 公开索引里有一条同名评论记录，但它不能证明评论者就是截图中的 ID。

- 截图显示昵称为“喝口椰汁”，抖音号是 367232722。
- 抖音视频《沈阳母婴店老板一天都干点啥？》的评论区出现了完全相同的昵称；这是评论记录，视频由他人发布，页面也没有显示可与 367232722 对应的唯一账号信息。[视频页](https://www.douyin.com/video/reference-one)
- 《大学生租房故事》评论区出现近似昵称“喝口椰汁”，尾标不同，也没有 ID 可供核对，我把它列为未证实的同名线索。[视频页](https://www.douyin.com/video/reference-two)

我按昵称和 ID 查了小红书、快手、微博、B站、TikTok、Instagram 等公开索引，没有找到能通过主页互链或 ID 对上的账号；部分平台的网页内容受限，因此“没搜到”不能证明“没有”。截图里的二维码也没能解出可打开的主页链接，抖音网页端搜索只显示加载占位。

若要继续核查账号本人发布的作品，最有用的是抖音主页的分享链接；有了直链，才能沿主页内容和公开互链继续比对。本次检索耗时约 6 分钟。`;
  let rows = [
    {
      ...base(1),
      kind: "turnHeader",
      entityId: "first-header",
      state: "completed",
      startedAt,
      completedAt: startedAt + 682000,
    },
    {
      ...base(2),
      kind: "userInput",
      entityId: "first-user",
      text: "全网深度搜索这个账号和相关视频，包括是否还有其他平台的\n\nReferenced image files:\n\n•",
      state: "accepted",
    },
    { ...base(3), kind: "reasoning", text: "搜索公开网页并核对账号信息。", state: "complete" },
    {
      ...base(4),
      kind: "toolCall",
      toolCallId: "search",
      toolName: "WebSearch",
      input: { query: "网页搜索" },
      inputText: "",
      status: "success",
      output: { text: "已检索公开索引。" },
    },
    {
      ...base(5),
      kind: "assistantText",
      entityId: "first-answer",
      text: firstText,
      state: "complete",
      actions: { canFork: true },
    },
    { ...base(6, "second"), kind: "turnHeader", entityId: "second-header", state: "completed" },
    {
      ...base(7, "second"),
      kind: "userInput",
      entityId: "second-user",
      text: "你不能扫二维码吗，进去搜索",
      state: "accepted",
    },
    {
      ...base(8, "second"),
      kind: "assistantText",
      entityId: "second-answer",
      text: "我刚试过本地扫码：这张抖音圆码没有解析出主页链接。我也打开了 [抖音号 367232722 的用户搜索页](https://www.douyin.com/search/reference)，但网页提示“登录后即可搜索更多精彩视频”，当前没有登录态，结果被挡住了。\n\n请在抖音 App 把这张图截图后，把打开的主页分享链接贴给我，我就能继续核对主页作品和其他平台的互链。",
      state: "complete",
      actions: { canFork: true },
    },
  ];
  const context = {
    workspacePath: "/fixture/mycode",
    sessionId: "reference-session",
    logEpoch: 1,
    theme: "mycode-dark",
    codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
    messageStreamShowReasoning: true,
    onOpenBrowserUrl: () => counts.browser++,
    onOpenCodeViewer: () => counts.preview++,
  };
  let extra = false;
  const render = (options) => {
    extra = options?.extra ?? extra;
    const model = buildConversationInventory(rows, context.workspacePath);
    const units = buildConversationTurnRenderUnits(rows);
    if (units[0]?.workStatus) units[0].workStatus.durationMs = 682000;
    const columnClass = `mx-auto ${getConversationContentWidthClassName({ centeredEmptyLayout: false, statusPanelLayout: "inline" })} ${getConversationStatusPanelOffsetClassName("inline")}`;
    root.render(
      h(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        h(
          ServiceProvider,
          { services: useRemoteWorkspaceSessionStore.getState().baseServices },
          h(
            PlatformProvider,
            { platform },
            h(
              TabStoreProvider,
              null,
              h(
                TooltipProvider,
                null,
                h(
                  "main",
                  { className: "relative h-full min-w-0" },
                  h(
                    "div",
                    {
                      className: "h-full overflow-auto px-4 pb-40 pt-6",
                      "data-reference-reading-scroll": "",
                    },
                    h(
                      "div",
                      { className: columnClass, "data-reference-column": "" },
                      extra
                        ? h(AssistantPreviewCards, {
                            cards: [
                              {
                                id: "test-site",
                                type: "website",
                                title: "127.0.0.1:8765",
                                url: "http://127.0.0.1:8765",
                                subtitleId: "assistantPreview.website",
                              },
                            ],
                            workspacePath: context.workspacePath,
                            onOpenBrowserUrl: context.onOpenBrowserUrl,
                          })
                        : null,
                      ...units.map((unit) =>
                        h(ConversationTurnGroup, {
                          key: unit.key,
                          unit,
                          context,
                          onFork: () => counts.preview++,
                          onFeedbackChange: () => {},
                        }),
                      ),
                    ),
                  ),
                  h(ConversationStatusPanel, {
                    workspacePath: context.workspacePath,
                    summaryPanelVariantOverride: "panel",
                    layoutMode: "inline",
                    showEmpty: true,
                    inventory: {
                      model,
                      context,
                      rows,
                      hasOlder: false,
                      onLoadAll: async () => ({ status: "completed" }),
                      onLocate: () => counts.locate++,
                      onAddSource: () => counts.add++,
                    },
                  }),
                  h(
                    "div",
                    { className: `absolute inset-x-0 bottom-4 px-4` },
                    h(
                      "div",
                      {
                        className: `${columnClass} px-4 @md/conversation:px-6`,
                        id: "reference-composer-slot",
                      },
                      h(ConversationComposer, composerProps),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };
  applyTheme("mycode-dark");
  render();
  window.__referenceFixture = {
    root,
    host,
    rows,
    context,
    render,
    counts,
    applyTheme,
    composer,
    mountComposer: () => {},
    setContextDetails: (present) => {
      composerProps.snapshot = {
        ...composerProps.snapshot,
        usage: {
          contextWindow: {
            usedTokens: 32000,
            maxTokens: 128000,
            ...(present
              ? {
                  cache: {
                    inputTokens: 32000,
                    cacheReadTokens: 28800,
                    cacheWriteTokens: 0,
                    hitRate: 0.9,
                    hitRateRequestCount: 3,
                  },
                  breakdown: [
                    { source: "messages", chars: 9000 },
                    { source: "system_prompt", chars: 1000 },
                  ],
                }
              : {}),
          },
        },
      };
      render();
    },
    addGuide: () => {
      rows = [
        ...rows.slice(0, 4),
        { ...base(10), kind: "userInput", text: "继续核对", state: "accepted" },
        {
          ...base(11),
          kind: "toolCall",
          toolCallId: "read",
          toolName: "Read",
          input: { file_path: "/fixture/read.txt" },
          inputText: "",
          status: "success",
          output: { text: "核对完成" },
        },
        ...rows.slice(4),
      ];
      render();
    },
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}
