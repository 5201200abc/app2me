import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { verifyReferenceToolTimeline } from "./mycode-reference-tool-timeline.mjs";

async function verifyGroupPriority(page, output) {
  const scenarios = [
    { names: ["Skill", "mcp__cua__press_key"], text: "已加载工具、使用计算机操作", icon: "tool" },
    { names: ["Read"], text: "读取文件", icon: "book" },
    { names: ["Read", "Bash"], text: "已读取文件、运行命令", icon: "book" },
    { names: ["Edit", "Read"], text: "已编辑文件、读取文件", icon: "edit" },
    {
      names: ["mcp__cua__press_key", "Read"],
      text: "已使用计算机操作、读取文件",
      icon: "pointer-2",
    },
    {
      names: ["mcp__github__issue", "Read"],
      text: "已使用 github 集成、读取文件",
      icon: "layout-dashboard",
    },
  ];
  const group = page.locator(
    '[data-reference-fixture] [data-tool-layout-variant="operations"] > [data-process-row]',
  );
  for (const [index, scenario] of scenarios.entries()) {
    await page.evaluate(({ names }) => {
      const f = window.__referenceFixture;
      const original = f.rows[0];
      f.rows.splice(
        0,
        f.rows.length,
        ...names.map((name, i) => ({
          ...original,
          rowId: 950 + i,
          toolCallId: "icon-priority-" + i,
          toolName: name,
          input: name === "Skill" ? { skill: "computer-use" } : {},
          status: "success",
          display: name.startsWith("mcp__")
            ? {
                kind: "mcp_tool",
                serverName: name.includes("github") ? "github" : "cua_driver",
                toolName: "press_key",
              }
            : undefined,
          output: { text: "Original result" },
        })),
      );
      f.render("zh-CN");
    }, scenario);
    await group.waitFor();
    await page.waitForTimeout(150);
    assert.equal(await group.innerText(), scenario.text);
    assert.match(
      await group.locator("[data-process-icon] svg").getAttribute("class"),
      new RegExp("tabler-icon-" + scenario.icon + "(?: |$)"),
    );
    if (index < 2)
      await group.screenshot({ scale: "css", path: join(output, "priority-" + index + ".png") });
  }
}

async function verifySidebarHeader(page, output) {
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { DesktopTopOverlay } = await f.load("DesktopTopOverlay.tsx");
    const { MyCodeIntlProvider } = await f.load("i18n/IntlProvider.tsx");
    window.__headerFixture = {
      counters: { back: 0, forward: 0, toggle: 0, search: 0 },
      render(os = "mac", locale = "zh-CN", disabled = false, visible = true) {
        const c = this.counters;
        f.render({
          extra: f.h(
            MyCodeIntlProvider,
            { initialLocale: locale, key: locale },
            f.h(
              "div",
              {
                "data-header-fixture": "",
                style: {
                  position: "fixed",
                  left: 0,
                  top: 0,
                  width: "240px",
                  height: "56px",
                  background: "var(--color-sidebar)",
                  "--workspace-sidebar-panel-width": "240px",
                  zIndex: 80,
                },
              },
              f.h(DesktopTopOverlay, {
                workspaceAbsPath: "/fixture/default",
                isDesktop: os !== "web",
                isMacDesktop: os === "mac",
                isWindowsDesktop: os === "windows",
                macWindowControlsLeftPaddingPx: 96,
                windowsWindowControlsRightPaddingPx: 138,
                isSidebarVisible: visible,
                updateReadyVersion: null,
                updateState: null,
                toggleSidebarShortcutLabel: "⌘B",
                newTaskShortcutLabel: "⌘N",
                goBackShortcutLabel: "⌘[",
                goForwardShortcutLabel: "⌘]",
                searchShortcutLabel: "⌘K",
                canTaskNavBack: !disabled,
                canTaskNavForward: !disabled,
                canGoBack: !disabled,
                canGoForward: !disabled,
                appLogoUrl: "data:image/png;base64," + f.png,
                platform: {},
                onToggleSidebar: () => c.toggle++,
                onCreateTask() {},
                onGoBack: () => c.back++,
                onGoForward: () => c.forward++,
                onOpenSearch: () => c.search++,
              }),
            ),
          ),
        });
      },
    };
    window.__headerFixture.render();
  });
  const header = page.getByTestId("desktop-top-overlay");
  const back = header.getByTestId("desktop-top-nav-back");
  const forward = header.getByTestId("desktop-top-nav-forward");
  const toggle = header.getByTestId("desktop-top-sidebar-toggle");
  const search = header.getByTestId("desktop-top-search");
  const results = [];
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const os of ["mac", "windows", "linux"]) {
      for (const locale of ["zh-CN", "en-US"]) {
        await page.evaluate(({ os, locale }) => window.__headerFixture.render(os, locale), {
          os,
          locale,
        });
        await search.waitFor();
        await page.waitForTimeout(150);
        const b = await back.boundingBox(),
          f = await forward.boundingBox(),
          t = await toggle.boundingBox(),
          s = await search.boundingBox(),
          h = await header.boundingBox();
        assert.ok(b.x + b.width <= f.x);
        assert.ok(f.x + f.width <= t.x);
        assert.ok(t.x + t.width <= s.x);
        assert.ok(Math.abs(s.x + s.width - (h.x + h.width - 8)) < 1);
        assert.ok(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)) < 1);
        assert.equal(await search.innerText(), "");
        assert.equal(
          await search.getAttribute("aria-label"),
          locale === "zh-CN" ? "搜索" : "Search",
        );
        assert.equal(
          await search.evaluate((el) => getComputedStyle(el).getPropertyValue("app-region")),
          "no-drag",
        );
        await back.click();
        await forward.click();
        await toggle.click();
        await search.click();
        await search.focus();
        await page.keyboard.press("Enter");
        results.push({ os, theme, locale, positions: { b, f, t, s } });
        await header.screenshot({
          scale: "css",
          path: join(output, "header-" + os + "-" + theme + "-" + locale + ".png"),
        });
      }
    }
  }
  assert.deepEqual(await page.evaluate(() => window.__headerFixture.counters), {
    back: 12,
    forward: 12,
    toggle: 12,
    search: 24,
  });
  await page.evaluate(() => window.__headerFixture.render("mac", "zh-CN", true));
  assert.equal(await back.isDisabled(), true);
  assert.equal(await forward.isDisabled(), true);
  await search.hover();
  await page.getByRole("tooltip").filter({ hasText: "搜索" }).waitFor();
  assert.match(await page.getByRole("tooltip").innerText(), /⌘K/);
  await page.evaluate(() => window.__headerFixture.render("mac", "zh-CN", false, false));
  await page.waitForTimeout(350);
  assert.equal(await search.count(), 0);
  assert.equal(await header.getByTestId("desktop-top-settings").count(), 0);
  assert.equal(await header.locator(".tabler-icon-settings").count(), 0);
  await header.getByTestId("desktop-top-new-task").waitFor({ state: "visible" });
  await page.evaluate(() => window.__headerFixture.render("web"));
  assert.equal(await search.count(), 0);
  const sidebar = await readFile("packages/ui/src/WorkspaceSidebar.tsx", "utf8");
  assert.match(
    sidebar,
    /\{!isDesktop \? \(\s*<Button\s*variant="ghost"\s*onClick=\{onOpenCommandCenter\}/,
  );
  const shell = await readFile("packages/ui/src/app-shell/WorkspaceShellLayout.tsx", "utf8");
  assert.match(shell, /onOpenSearch=\{handleOpenCommandCenter\}/);
  return results;
}

export async function verifyOperationIconsAndSidebarHeader(page, output) {
  const timeline = await verifyReferenceToolTimeline(page, output);
  await verifyGroupPriority(page, output);
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--ui-font-size");
  });
  const header = await verifySidebarHeader(page, output);
  return { passed: true, timeline, header };
}
