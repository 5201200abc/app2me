export async function mountConversationFixture(page, filePath) {
  await page.evaluate(
    async ({ cwd, filePath }) => {
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
      const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
      const domModule = await import(
        resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
      );
      const React = reactModule.default ?? reactModule;
      const { createRoot } = domModule.default ?? domModule;
      const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
      const { ConversationTurnGroup } = await load("v4/ConversationTurnGroup.tsx");
      const { ConversationRowView } = await load("v4/ConversationRowView.tsx");
      const { ConversationTimeline } = await load("v4/ConversationTimeline.tsx");
      const { buildConversationTurnRenderUnits } = await load("v4/conversationTurnRenderUnits.ts");
      const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
      const { PlatformProvider } = await load("hooks/usePlatform.tsx");
      const { ServiceProvider } = await load("hooks/useServices.tsx");
      const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
      const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
      const { TooltipProvider } = await load("components/ui/tooltip.tsx");
      const { DEFAULT_CODE_PREVIEW_SETTINGS } = await load("lib/codePreviewSettings.ts");
      const { applyTheme } = await load("useTheme.ts");
      const host = document.createElement("div");
      host.id = "conversation-presentation-fixture";
      host.style.cssText =
        "position:fixed;inset:0;overflow:auto;z-index:10000;background:var(--color-background)";
      document.body.append(host);
      const root = createRoot(host);
      const counters = { preview: 0, browser: 0, rewind: 0, edited: 0, copied: "" };
      const fileChanges = {
        files: 1,
        additions: 394,
        deletions: 0,
        state: "active",
        items: [
          {
            path: filePath,
            additions: 394,
            deletions: 0,
            writeCount: 1,
            toolNames: ["Write"],
            patches: [
              { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+<!doctype html>"] },
            ],
          },
        ],
      };
      const fetchFileChanges = async () => fileChanges;
      const previewFileRewind = async () => {
        counters.rewind++;
        return { canApply: false, safeFiles: [], unsafeFiles: [], ignoredFiles: [] };
      };
      const originalClipboardWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (text) => {
        counters.copied = text;
      };
      const now = Date.now();
      const initialQuestion =
        "创建一个带有骑自行车的鹈鹕的动画 2D SVG 的 HTML 文件。请让车轮旋转、腿部动作自然，并加入背景与围巾动画。";
      const answer = `我会先读取现有文件，再绘制骑自行车的鹈鹕。\n\n${"车轮、腿部与围巾使用协调的动画，脚掌始终保持稳定接触。".repeat(6)} 内联代码：\`${"requestAnimationFrame".repeat(8)}\`。\n\n- 保留页面结构\n- 验证视觉效果\n\n**完成后可直接预览。** 文件：[pelican-bicycle-v2.html](${filePath})`;
      const base = (rowId, turnId) => ({
        rowId,
        turnId,
        entityId: `fixture-${rowId}`,
        createdAt: now,
        createdAtSeq: rowId,
      });
      const rowsFor = (question, running) => {
        const turnId = running ? "fixture-live" : "fixture-complete";
        const offset = running ? 100 : 0;
        return [
          {
            ...base(offset + 1, turnId),
            kind: "turnHeader",
            origin: "userInput",
            executionKind: "agent",
            state: running ? "running" : "completedSuccess",
            startedAt: now - 34000,
            ...(running
              ? {}
              : {
                  endedAt: now,
                  activeMs: 34000,
                  fileChanges: { files: 1, additions: 394, deletions: 0, state: "active" },
                  actions: { canRewindFiles: true },
                }),
          },
          {
            ...base(offset + 2, turnId),
            kind: "userInput",
            origin: "realUser",
            text: question,
            actions: { canEdit: true },
          },
          {
            ...base(offset + 3, turnId),
            kind: "reasoning",
            state: running ? "streaming" : "complete",
            text: "Hmm, but ground contact should remain stable.\n先检查现有文件，避免覆盖已有内容。",
            ...(running ? {} : { durationMs: 3000 }),
          },
          ...(running
            ? []
            : [
                {
                  ...base(4, turnId),
                  kind: "assistantText",
                  text: "先检查文件与动画结构，再决定是否覆盖。",
                  state: "complete",
                },
                {
                  ...base(5, turnId),
                  kind: "toolCall",
                  toolCallId: "fixture-write",
                  toolName: "Write",
                  status: "error",
                  inputText: "",
                  input: {
                    filePath: `${cwd}/pelican-bicycle.html`,
                    content: "<html>animation</html>",
                  },
                  output: { text: "写入失败：测试中的文件不可写。" },
                  error: { message: "写入失败：测试中的文件不可写。", code: "fixture_error" },
                },
                {
                  ...base(6, turnId),
                  kind: "toolCall",
                  toolCallId: "fixture-read",
                  toolName: "Read",
                  status: "success",
                  inputText: "",
                  input: { filePath: `${cwd}/pelican-bicycle.html` },
                  output: { text: "已读取文件内容。" },
                },
                {
                  ...base(7, turnId),
                  kind: "toolCall",
                  toolCallId: "fixture-read-second",
                  toolName: "Read",
                  status: "success",
                  inputText: "",
                  input: { filePath: `${cwd}/README.md` },
                  output: { text: "已读取说明。" },
                },
                { ...base(8, turnId), kind: "assistantText", text: answer, state: "complete" },
              ]),
        ];
      };
      let theme = "mycode-dark";
      let question = initialQuestion;
      let groupReads = false;
      let timeline = false;
      let includeLiveTail = false;
      let panel = "none";
      const initialModelChange = {
        type: "modelChange",
        fromProvider: "deepseek",
        fromModel: "deepseek-flash",
        toProvider: "llama",
        toModel: "Qwen3.8-27B",
        toThought: "xhigh",
      };
      let modelChange = initialModelChange;
      const render = (options = {}) => {
        theme = options.theme ?? theme;
        question = options.question ?? question;
        groupReads = options.groupReads ?? groupReads;
        timeline = options.timeline ?? timeline;
        includeLiveTail = options.includeLiveTail ?? includeLiveTail;
        panel = options.panel ?? panel;
        modelChange = options.modelChange ?? modelChange;
        const context = {
          workspacePath: cwd,
          modelSelectionView: {
            providers: [
              { providerId: "deepseek", providerName: "DeepSeek" },
              { providerId: "llama", providerName: "Local Models (llama.cpp)" },
            ],
          },
          theme,
          codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
          messageStreamShowReasoning: true,
          toolGroupingExploreEnabled: groupReads,
          toolGroupingChangesEnabled: false,
          onOpenCodeViewer: () => counters.preview++,
          onOpenBrowserUrl: () => counters.browser++,
          fetchFileChanges,
          previewFileRewind,
          applyFileRewind: async () => ({ status: "accepted" }),
        };
        const units = [false, true].map(
          (running) =>
            buildConversationTurnRenderUnits(rowsFor(running ? "继续检查" : question, running), {
              nowMs: now,
            })[0],
        );
        const timelineRows = [
          ...rowsFor(question, false),
          ...(includeLiveTail
            ? [
                ...rowsFor("继续检查", true),
                {
                  ...base(104, "fixture-live"),
                  kind: "assistantText",
                  text: "实时尾部的回答也与输入框对齐。",
                  state: "complete",
                  actions: { canFork: true },
                },
              ]
            : []),
        ];
        const h = React.createElement;
        const stage = h(
          "main",
          {
            className: timeline
              ? "@container/conversation flex h-full w-full flex-col text-foreground"
              : "@container/conversation mx-auto w-full max-w-[49rem] xl:max-w-5xl py-6 text-foreground",
            "data-fixture-stage": true,
          },
          ...(!timeline
            ? [
                h(ConversationRowView, {
                  key: "model-switch",
                  context,
                  row: {
                    ...base(201, "fixture-model-change"),
                    kind: "timelineMarker",
                    placement: "lightBoundary",
                    marker: modelChange,
                  },
                }),
                h(ConversationRowView, {
                  key: "model-first-use",
                  context,
                  row: {
                    ...base(202, "fixture-model-first-use"),
                    kind: "timelineMarker",
                    placement: "lightBoundary",
                    marker: {
                      type: "modelChange",
                      toProvider: "llama",
                      toModel: "Qwen3.8-27B",
                      toThought: "xhigh",
                    },
                  },
                }),
              ]
            : []),
          ...(timeline
            ? [
                h(ConversationTimeline, {
                  rows: timelineRows,
                  totalCount: timelineRows.length,
                  sessionKey: "fixture-alignment",
                  rowContext: context,
                  summaryPanelLayout: panel,
                  hideTurnNavigator: true,
                  bottomDock: h("textarea", {
                    "data-fixture-composer": true,
                    className:
                      "block h-20 w-full rounded-xl border border-border bg-input p-2 text-ui-caption",
                    defaultValue: "提出后续修改要求",
                  }),
                }),
              ]
            : units.map((unit, index) =>
                h(
                  "section",
                  {
                    key: unit.key,
                    "data-fixture-turn": index ? "live" : "complete",
                    className: "mb-5",
                  },
                  h(ConversationTurnGroup, {
                    unit,
                    context,
                    onEdit: () => {
                      counters.edited++;
                      return true;
                    },
                  }),
                ),
              )),
        );
        root.render(
          h(
            MyCodeIntlProvider,
            { initialLocale: "zh-CN" },
            h(
              PlatformProvider,
              { platform: {} },
              h(
                ServiceProvider,
                { services: useRemoteWorkspaceSessionStore.getState().baseServices },
                h(TabStoreProvider, null, h(TooltipProvider, null, stage)),
              ),
            ),
          ),
        );
      };
      render();
      window.__conversationFixture = {
        root,
        host,
        render,
        counters,
        initialQuestion,
        initialModelChange,
        answer,
        applyTheme,
        originalClipboardWrite,
      };
    },
    { cwd: process.cwd(), filePath },
  );
}
