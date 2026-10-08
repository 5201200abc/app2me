import { readInterfaceTypography } from "./mycode-interface-typography-metrics.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountFooterBarFixture } from "./mycode-footer-bar-fixture.mjs";

export async function verifyInterfaceTypography(page, output, app) {
  await mountFooterBarFixture(page);
  await page.evaluate(async () => {
    const f = window.__inventoryFixture,
      h = f.h;
    const { WorkspaceHeader } = await f.load("WorkspaceHeader.tsx");
    const { MemoTaskItem } = await f.load("TaskListItem.tsx");
    const { Button } = await f.load("components/ui/button.tsx");
    const { CalendarClock, Blocks } = await f.load("components/icons/tabler.tsx");
    const { NewTaskButtonGroup } = await f.load("NewTaskButtonGroup.tsx");
    const { ConversationTurnGroup } = await f.load("v4/ConversationTurnGroup.tsx");
    const { buildConversationTurnRenderUnits } = await f.load("v4/conversationTurnRenderUnits.ts");
    const { getConversationContentWidthClassName } = await f.load("v4/conversationLayout.ts");
    const { WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX } = await f.load(
      "app-shell/workspaceSidebarGeometry.ts",
    );
    const { useMyCodeIntl } = await f.load("i18n/IntlProvider.tsx");
    const font = await f.load("lib/uiFontSize.ts");
    localStorage.removeItem(font.UI_FONT_SIZE_STORAGE_KEY);
    font.applyUiFontSizePx(font.loadUiFontSizePx());
    const now = Date.now();
    const rows = [
      {
        rowId: 1,
        turnId: "type",
        kind: "turnHeader",
        state: "completedSuccess",
        startedAt: now - 13000,
        endedAt: now,
        createdAt: now - 13000,
      },
      {
        rowId: 2,
        turnId: "type",
        kind: "userInput",
        text: "今天北京下雨吗",
        entityId: "user",
        createdAt: now - 13000,
      },
      {
        rowId: 3,
        turnId: "type",
        kind: "reasoning",
        text: "查看天气信息。",
        state: "complete",
        createdAt: now - 10000,
      },
      {
        rowId: 4,
        turnId: "type",
        kind: "assistantText",
        entityId: "answer",
        actions: { canFork: true },
        state: "complete",
        createdAt: now,
        text: "今天北京不下雨。\n\n两个来源的结果一致：天气以晴到多云为主，没有降雨。\n\n- 天气状况：多云转晴\n- 气温：大约 13–20°C（夜间最低约 13–14°C，白天最高约 20°C）\n- 降水：预报降水量 0 毫米\n- 风力：3–4 级\n\n出门不用带伞，不过秋天昼夜温差较大，早晚偏凉，建议备一件外套。\n\n这段较长的说明用于检查窄屏下的换行：正文应完整留在阅读区域内，不越过输入框边缘，也不与会话状态或操作按钮重叠。",
      },
    ];
    const unit = buildConversationTurnRenderUnits(rows)[0];
    unit.assistantHistoryDefaultOpen = false;
    if (unit.workStatus) unit.workStatus.durationMs = 13000;
    const counts = { task: 0, panel: 0, feedback: 0, fork: 0 };
    const titles = [
      "查询北京今日天气",
      "动画 2D SVG 鹈鹕骑自行车 HTML 长标题需要保持单行省略号且不能与日期重叠",
      "你好",
      "你是谁",
      "点击电脑上的 Audio 应用",
      "验证 Computer Use 原生桌面控制与其他详细说明",
      "点击本机 VLC 应用",
    ];
    const column = getConversationContentWidthClassName({
      centeredEmptyLayout: false,
      statusPanelLayout: "none",
    });
    function Frame() {
      const { intl } = useMyCodeIntl();
      return h(
        "div",
        {
          "data-typography-frame": "",
          style: { position: "fixed", inset: 4, display: "flex", overflow: "hidden", zIndex: 100 },
        },
        h(
          "aside",
          {
            className: "workspace-sidebar",
            "data-typography-sidebar": "",
            style: {
              width: WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX,
              flex: "none",
              background: "var(--color-sidebar)",
              padding: 8,
              overflow: "auto",
            },
          },
          h("div", { style: { height: 48 } }),
          h(
            "div",
            { "data-sidebar-primary-actions": "", className: "flex flex-col gap-0.5 px-2 py-2.5" },
            h(NewTaskButtonGroup, { onCreateTask() {} }),
            ...[
              [CalendarClock, "自动化"],
              [Blocks, "插件"],
            ].map(([Icon, label]) =>
              h(
                Button,
                {
                  key: label,
                  size: "lg",
                  variant: "ghost",
                  "data-icon": "inline-start",
                  className: "w-full justify-start gap-2",
                  onClick() {},
                },
                h(Icon, { className: "size-4" }),
                label,
              ),
            ),
          ),
          h(
            "ul",
            {
              "data-sidebar-task-list": "",
              className: "space-y-0.5",
              style: { padding: 0, marginTop: 20 },
            },
            ...titles.map((title, i) =>
              h(MemoTaskItem, {
                key: i,
                workspacePath: "/fixture/default",
                task: {
                  taskId: `type-${i}`,
                  title,
                  workspacePath: "/fixture/default",
                  provider: "glm",
                  status: "completed",
                  updatedAt: now - 3 * 86400000,
                  createdAt: now - 3 * 86400000,
                },
                isActive: i === 0,
                isPinned: false,
                isArchiveConfirming: false,
                intl,
                onSelectTask: () => counts.task++,
                onArchiveTaskInline() {},
                onCancelArchiveConfirm() {},
                onTogglePinTask() {},
                onStartRenameTask() {},
                onArchiveTask() {},
                onMarkTaskAsUnread() {},
              }),
            ),
          ),
        ),
        h(
          "main",
          {
            "data-workspace-conversation-frame": "true",
            className: "conversation-reference-surface @container/conversation",
            style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column" },
          },
          h(WorkspaceHeader, {
            variant: "task",
            workspaceAbsPath: "/fixture/default",
            activeTaskTitle: "新会话",
            activeTaskId: null,
            activeTraceId: null,
            activeSessionId: null,
            activeTaskProvider: "glm",
            gitSummary: { isRepository: false },
            gitDirtyFileCount: 0,
            workspaceHeaderState: { selectedProvider: "glm" },
            isSidebarVisible: true,
            isDesktop: true,
            isMacDesktop: true,
            isTerminalOpen: false,
            isSidePaneOpen: false,
            onRefreshGit() {},
            onToggleTerminal() {},
            onToggleSidePane: () => counts.panel++,
            isSummaryPanelExpanded: false,
            onToggleSummaryPanel() {},
          }),
          h(
            "div",
            {
              "data-typography-scroll": "",
              style: { overflowY: "auto", minHeight: 0, flex: "1 1 0" },
            },
            h(
              "div",
              { className: column, style: { marginInline: "auto" } },
              h(ConversationTurnGroup, {
                unit,
                onFeedbackChange: () => {
                  counts.feedback++;
                },
                onFork: () => {
                  counts.fork++;
                },
                context: {
                  workspacePath: "/fixture/default",
                  sessionId: "typography",
                  logEpoch: "1",
                  codePreviewSettings: window.__typographyCodePreview,
                },
              }),
            ),
          ),
          h(
            "div",
            {
              "data-v4-composer-dock-content": "true",
              className: `${column} px-4`,
              style: { marginInline: "auto", paddingBottom: 16, paddingTop: 24, flex: "none" },
            },
            h(window.__footerBarFixture.Bar),
          ),
        ),
      );
    }
    const { DEFAULT_CODE_PREVIEW_SETTINGS } = await f.load("lib/codePreviewSettings.ts");
    window.__typographyCodePreview = DEFAULT_CODE_PREVIEW_SETTINGS;
    window.__typographyFixture = { font, counts };
    f.render({ empty: true, onlyExtra: true, extra: h(Frame) });
  });
  const frame = page.locator("[data-typography-frame]");
  await frame.locator(".conversation-answer").waitFor();
  const win = await app.browserWindow(page);
  await win.evaluate((win) => win.setBounds({ width: 1512, height: 982 }));
  const cdp = await page.context().newCDPSession(page);
  const metrics = [];
  const check = async (name) => {
    await page.mouse.move(0, 0);
    const m = await frame.evaluate(readInterfaceTypography);
    assert.equal(m.rootFont, "16px");
    assert.equal(m.token, "1rem");
    assert.equal(m.sidebar.width, 240);
    for (const t of [m.body, m.bubble, m.title]) assert.equal(t.font, "16px", JSON.stringify(m));
    for (const t of m.titles) {
      assert.equal(t.font, "15px");
      assert.equal(t.whiteSpace, "nowrap");
      assert.equal(t.overflow, "ellipsis");
    }
    for (const t of [m.meta, ...m.dates]) assert.equal(t.font, "13px", JSON.stringify(m));
    assert.equal(m.work.font, m.body.font);
    for (const t of [...m.titles, m.title, m.work, ...m.primary])
      assert.equal(t.weight, "400", JSON.stringify(t));
    assert.equal(m.primary.length, 3);
    assert.ok(
      Math.max(...m.primary.map((r) => r.textLeft)) -
        Math.min(...m.primary.map((r) => r.textLeft)) <
        0.1,
      JSON.stringify(m.primary),
    );
    for (const row of m.primary) assert.ok(Math.abs(row.height - (28 * 16) / 15) < 0.1);
    assert.ok(Math.abs(m.primary[1].top - m.primary[0].bottom - (2 * 16) / 15) < 0.1);
    assert.ok(Math.abs(Number.parseFloat(m.actions.gap) - 6.4) < 0.1);
    assert.equal(m.actions.buttons.length, 4);
    assert.ok(Math.abs(Number.parseFloat(m.body.line) - 27.2) < 0.02);
    assert.ok(Math.abs(Number.parseFloat(m.bubble.line) - 27.2) < 0.02);
    assert.equal(m.overlaps, false, JSON.stringify(m));
    assert.equal(m.overflow, false, JSON.stringify(m));
    assert.ok(
      m.controls.every(
        (c) => Math.abs(c.top + c.height / 2 - m.controls[0].top - m.controls[0].height / 2) < 1,
      ),
    );
    assert.ok(
      m.insets.every((n) => Math.abs(n - 12.8) < 0.1),
      JSON.stringify(m),
    );
    assert.ok(
      m.rows.every((r) => Math.abs(r.height - (28 * 16) / 15) < 0.1),
      JSON.stringify(m),
    );
    assert.ok(Math.abs(m.rows[1].top - m.rows[0].bottom - 16 / 15) < 0.1, JSON.stringify(m.rows));
    assert.ok(m.input.height >= 104, JSON.stringify(m));
    assert.ok(m.paragraphs.every((p) => p.right <= m.body.right + 1));
    metrics.push({ name, ...m });
  };
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const dpr of [1, 2]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1512,
        height: 982,
        deviceScaleFactor: dpr,
        mobile: false,
      });
      await check(`${theme}-${dpr}x`);
      const capture = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const png = Buffer.from(capture.data, "base64");
      assert.equal(png.readUInt32BE(16), 1512 * dpr);
      await writeFile(join(output, `${theme}-${dpr}x.png`), png);
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await win.evaluate((w) => w.webContents.setZoomFactor(2));
  await page.setViewportSize({ width: 1512, height: 982 });
  await check("zoom-2x");
  const zoomCapture = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(join(output, "zoom-2x.png"), Buffer.from(zoomCapture.data, "base64"));
  await win.evaluate((w) => w.webContents.setZoomFactor(1));
  await page.waitForFunction(() => innerWidth === 1512);
  await page.mouse.move(0, 0);
  const longTitle = frame.locator("[data-task-item-key]").nth(1);
  await longTitle.locator(".task-title-marquee").waitFor();
  await longTitle.hover();
  await page.waitForFunction(() =>
    document
      .querySelector(
        "[data-typography-sidebar] [data-task-item-key]:nth-child(2) [data-task-title-marquee-track]",
      )
      .getAnimations()
      .some((a) => a.playState === "running"),
  );
  await page.mouse.move(0, 0);
  await frame.locator("[data-task-item-key]").first().click();
  await frame.getByTestId("side-pane-toggle").click();
  await frame.getByTestId("v4-composer-send").click();
  const actions = frame.locator(".conversation-message-actions button");
  await actions.nth(1).click();
  await actions.nth(2).click();
  await actions.nth(3).click();
  assert.deepEqual(await page.evaluate(() => window.__typographyFixture.counts), {
    task: 1,
    panel: 1,
    feedback: 2,
    fork: 1,
  });
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.send), 1);
  const settings = await page.evaluate(() => {
    const font = window.__typographyFixture.font;
    localStorage.setItem(font.UI_FONT_SIZE_STORAGE_KEY, "13");
    font.applyUiFontSizePx(font.loadUiFontSizePx());
    const saved = {
      value: font.loadUiFontSizePx(),
      token: document.documentElement.style.getPropertyValue("--ui-font-size"),
    };
    localStorage.removeItem(font.UI_FONT_SIZE_STORAGE_KEY);
    font.applyUiFontSizePx(font.loadUiFontSizePx());
    return { saved, restored: font.loadUiFontSizePx() };
  });
  assert.deepEqual(settings, { saved: { value: 13, token: "0.8125rem" }, restored: 16 });
  return { passed: true, metrics, settings };
}
