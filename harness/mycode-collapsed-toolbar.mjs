import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyCollapsedToolbar(page, output) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 160,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { DesktopTopOverlay } = await f.load("DesktopTopOverlay.tsx");
    const { WorkspaceHeader } = await f.load("WorkspaceHeader.tsx");
    const style = document.createElement("style");
    style.textContent =
      "#inventory-tool-fixture [data-turn-key],#inventory-tool-fixture [data-testid=chat-summary-panel]{display:none}";
    document.head.append(style);
    window.__collapsedToolbar = {
      counts: { back: 0, forward: 0, toggle: 0, create: 0 },
      render(os = "mac", fullscreen = false, visible = false) {
        const c = this.counts;
        const h = f.h;
        f.render({
          extra: h(
            "div",
            {
              "data-collapsed-toolbar-fixture": "",
              style: {
                position: "fixed",
                top: 0,
                left: 0,
                width: "1100px",
                height: "60px",
                background: "var(--color-header)",
                "--workspace-sidebar-panel-width": "240px",
              },
            },
            h(
              "section",
              {
                style: {
                  position: "absolute",
                  top: "4px",
                  left: visible ? "240px" : "4px",
                  right: "4px",
                },
                className: "border border-border",
              },
              h(WorkspaceHeader, {
                variant: "task",
                workspaceAbsPath: "/fixture/default",
                projectName: "Default",
                activeTaskTitle: "测试会话",
                hasUpdateReady: false,
                activeTaskId: null,
                activeTraceId: null,
                activeSessionId: null,
                activeTaskProvider: null,
                sessionLogPath: null,
                nativeSessionLogProvider: null,
                nativeSessionLogPath: null,
                nativeSessionLogExists: false,
                nativeSessionLogLoading: false,
                workspaceHeaderState: { selectedProvider: "mycode" },
                gitSummary: { isRepository: false },
                gitDirtyFileCount: 0,
                isDesktop: true,
                isMacDesktop: os === "mac",
                isWindowsDesktop: os === "windows",
                isMacFullscreen: fullscreen,
                isSidebarVisible: visible,
                isTerminalOpen: false,
                isSidePaneOpen: false,
                onRefreshGit() {},
                onToggleTerminal() {},
                onToggleBrowser() {},
                onToggleSidePane() {},
                onReloadSession() {},
                onCreateTask() {},
                onOpenWorkspace() {},
              }),
            ),
            h(DesktopTopOverlay, {
              workspaceAbsPath: "/fixture/default",
              isDesktop: true,
              isMacDesktop: os === "mac",
              isWindowsDesktop: os === "windows",
              isMacFullscreen: fullscreen,
              macWindowControlsLeftPaddingPx: 96,
              windowsWindowControlsRightPaddingPx: 138,
              isSidebarVisible: visible,
              updateReadyVersion: null,
              updateState: null,
              toggleSidebarShortcutLabel: "⌘B",
              newTaskShortcutLabel: "⌘N",
              goBackShortcutLabel: "⌘[",
              goForwardShortcutLabel: "⌘]",
              canTaskNavBack: true,
              canTaskNavForward: true,
              canGoBack: true,
              canGoForward: true,
              appLogoUrl: "data:image/png;base64," + f.png,
              platform: {},
              onToggleSidebar: () => c.toggle++,
              onCreateTask: () => c.create++,
              onGoBack: () => c.back++,
              onGoForward: () => c.forward++,
            }),
          ),
        });
      },
    };
    window.__collapsedToolbar.render();
  });
  const results = [];
  const fixture = page.locator("[data-collapsed-toolbar-fixture]");
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const [os, fullscreen] of [
      ["mac", false],
      ["mac", true],
      ["windows", false],
      ["linux", false],
    ]) {
      await page.evaluate(
        ({ os, fullscreen }) => window.__collapsedToolbar.render(os, fullscreen),
        { os, fullscreen },
      );
      const controls = page.locator("[data-desktop-toolbar-action]");
      await fixture.getByTestId("desktop-top-new-task").waitFor();
      await page.waitForTimeout(350);
      const metrics = await controls.evaluateAll((els) =>
        els.map((el) => {
          const svg = el.querySelector("svg");
          const i = svg.getBoundingClientRect(),
            b = el.getBoundingClientRect(),
            s = getComputedStyle(svg);
          return {
            title: el.getAttribute("aria-label"),
            cls: svg.getAttribute("class"),
            width: i.width,
            height: i.height,
            stroke: s.strokeWidth,
            center: i.y + i.height / 2,
            buttonWidth: b.width,
            buttonHeight: b.height,
            buttonCenter: b.y + b.height / 2,
          };
        }),
      );
      assert.equal(metrics.length, 5);
      for (const m of metrics) {
        assert.equal(m.width, 16);
        assert.equal(m.height, 16);
        assert.equal(m.stroke, "1.5px");
        assert.equal(m.buttonWidth, 28);
        assert.equal(m.buttonHeight, 28);
        assert.ok(Math.abs(m.center - m.buttonCenter) < 0.1);
        assert.ok(Math.abs(m.center - metrics[0].center) < 0.1);
      }
      assert.match(metrics[0].cls, /folder/);
      assert.equal(await fixture.locator(".tabler-icon-settings").count(), 0);
      for (const id of [
        "desktop-top-nav-back",
        "desktop-top-nav-forward",
        "desktop-top-sidebar-toggle",
        "desktop-top-new-task",
      ])
        await fixture.getByTestId(id).click();
      await fixture.getByTestId("desktop-top-new-task").focus();
      await page.keyboard.press("Enter");
      results.push({ theme, os, fullscreen, metrics });
      await fixture.screenshot({
        scale: "css",
        path: join(
          output,
          "collapsed-" + os + (fullscreen ? "-fullscreen" : "") + "-" + theme + ".png",
        ),
      });
    }
  }
  assert.deepEqual(await page.evaluate(() => window.__collapsedToolbar.counts), {
    back: 8,
    forward: 8,
    toggle: 8,
    create: 16,
  });
  await page.evaluate(() => window.__collapsedToolbar.render("mac", false, true));
  await page.waitForTimeout(350);
  const expanded = await fixture.getByTestId("desktop-top-sidebar-toggle").boundingBox();
  assert.equal(expanded.y + expanded.height / 2, 30);
  return { passed: true, results };
}
