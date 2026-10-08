import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function mountFooterBarFixture(page) {
  const source = await readFile("packages/ui/src/v4/ConversationComposer.tsx", "utf8");
  assert.match(source, /<V4ComposerSubmitControls>\s*\{modeSwitchNode\}/);
  assert.ok(source.includes("contextHeader(null)"));
  const leading = source.slice(
    source.indexOf("leadingActions={"),
    source.indexOf("goalMarkerContainer={goalMarkerContainer}"),
  );
  assert.ok(leading.includes("contextUsageNode") && !leading.includes("modeSwitchNode"));
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture,
      h = f.h;
    const { useState } = window.__fixtureBootstrap.React;
    const { ChatPromptEditor } = await f.load("prompt-editor/ChatPromptEditor.tsx");
    const { V4ComposerModelControls } = await f.load("v4/composer/V4ComposerToolbar.tsx");
    const { V4ComposerModeSwitch } = await f.load("v4/composer/V4ComposerModeControls.tsx");
    const { V4ComposerContextUsage, V4ComposerSubmitControls } = await f.load(
      "v4/composer/V4ComposerSubmitControls.tsx",
    );
    const { Button } = await f.load("components/ui/button.tsx");
    const { ArrowUp, Folder } = await f.load("components/icons/tabler.tsx");
    const { WorkspaceSidebarFooter } = await f.load("WorkspaceSidebarFooter.tsx");
    const counts = { send: 0, settings: 0, usage: 0, docs: 0, mode: 0, model: 0, add: 0 };
    const config = {
      mode: "yolo",
      modelSelection: {
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
        options: { reasoningLevel: "high" },
      },
    };
    const model = {
      modelId: "deepseek-v4-pro",
      config: {
        properties: { displayName: "DeepSeek-V4-Pro" },
        optionSpecs: {
          reasoningLevel: { values: ["low", "medium", "high", "max"], defaultValue: "high" },
        },
      },
    };
    const view = {
      revision: 1,
      providers: [
        {
          providerId: "deepseek",
          providerName: "DeepSeek",
          config: { api: { type: "openai" }, logo: { type: "builtin", key: "deepseek" } },
          models: [model],
        },
      ],
    };
    const usage = { contextWindow: { usedTokens: 32000, maxTokens: 128000 } };
    function Bar({ disabled = false, long = false, draft = false, reasoning = true }) {
      const [picker, setPicker] = useState(null);
      const props = {
        workspacePath: "/fixture/default",
        sessionId: null,
        phase: null,
        draftConfig: config,
        modelSelectionView: !reasoning
          ? {
              ...view,
              providers: [
                {
                  ...view.providers[0],
                  models: [{ ...model, config: { ...model.config, optionSpecs: {} } }],
                },
              ],
            }
          : long
            ? {
                ...view,
                providers: [
                  {
                    ...view.providers[0],
                    models: [
                      {
                        ...model,
                        config: {
                          ...model.config,
                          properties: {
                            displayName:
                              "DeepSeek-V4-Pro-with-a-very-long-model-name-for-truncation",
                          },
                        },
                      },
                    ],
                  },
                ],
              }
            : view,
        modelSelectionState: { status: "ready" },
        usage,
        disabled,
        activeConfigPicker: picker,
        onConfigPickerOpenChange: (p, open) => setPicker(open ? p : null),
        onSelectModel: () => counts.model++,
        onSelectThought: () => {},
        onSwitchMode: () => counts.mode++,
      };
      const editor = h(ChatPromptEditor, {
        workspacePath: "/fixture/default",
        taskId: null,
        placeholder: "提出后续修改要求",
        submitLabel: "发送",
        uniformToolbar: true,
        disabled,
        allowSubmitWhenEmpty: true,
        enableMentionPanel: false,
        showSlashButton: true,
        attachmentAction: { label: "添加附件", onSelect: () => counts.add++ },
        leadingActions: h(
          window.__fixtureBootstrap.React.Fragment,
          null,
          h(
            "span",
            { className: "flex min-w-0 shrink items-center gap-1" },
            h(V4ComposerModelControls, props),
          ),
          h(V4ComposerContextUsage, { usage, disabled }),
        ),
        submitControl: h(
          V4ComposerSubmitControls,
          {},
          h(
            "span",
            {
              "data-composer-permission-actions": "",
              className: "flex min-w-0 items-center gap-1",
            },
            h(V4ComposerModeSwitch, props),
          ),
          h(
            Button,
            { type: "submit", disabled, "data-testid": "v4-composer-send", "aria-label": "发送" },
            h(ArrowUp, { className: "size-4" }),
          ),
        ),
        onSubmit: () => {
          counts.send++;
          return false;
        },
      });
      return !draft
        ? editor
        : h(
            "div",
            { className: "chat-composer-input-surface rounded-[18px] bg-surface/60 shadow-xs" },
            h(
              "div",
              {
                "data-composer-project-controls": "",
                className: "flex min-w-0 items-center gap-1 p-1",
              },
              h(
                Button,
                { variant: "ghost", disabled },
                h(Folder, { className: "size-4" }),
                "选择项目",
              ),
            ),
            editor,
          );
    }
    const render = (options = {}) =>
      f.render({
        empty: true,
        onlyExtra: !options.summary,
        context: { workspacePath: "/fixture/default" },
        platform: { openExternal: () => counts.docs++ },
        extra: h(
          "div",
          {
            "data-footer-bar-fixture": "",
            className: "conversation-reference-surface",
            style: { width: options.width ?? 760 },
          },
          h("div", { "data-bar-stage": "" }, h(Bar, options)),
          h(
            "div",
            { "data-footer-stage": "", style: { width: 240, marginTop: 32 } },
            h(WorkspaceSidebarFooter, {
              isDesktop: true,
              theme: "mycode-dark",
              localeMenuValue: "zh-CN",
              onLocaleChange: () => {},
              onThemeChange: () => {},
              onSettingsButtonClick: () => counts.settings++,
              onUsageClick: () => counts.usage++,
            }),
          ),
        ),
      });
    window.__footerBarFixture = { render, counts, Bar };
    render();
  });
}
