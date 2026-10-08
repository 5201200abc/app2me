import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySidebarRefinement(page, output) {
  const sidebar = page.locator(".workspace-sidebar");
  const project = sidebar.getByRole("tab", { name: "项目", exact: true });
  const all = sidebar.getByRole("tab", { name: "全部", exact: true });
  const create = sidebar.getByTestId("sidebar-project-create-group");
  const sort = sidebar.getByTestId("sidebar-task-sort");
  const empty = sidebar.getByText("暂无项目", { exact: true });
  const font = await empty.evaluate((el) => getComputedStyle(el).fontSize);
  const titleFont = await sidebar
    .getByText("项目", { exact: true })
    .last()
    .evaluate((el) => getComputedStyle(el).fontSize);
  assert.equal(font, "12px");
  assert.equal(titleFont, "13px");
  const createBounds = await create.boundingBox();
  const sortBounds = await sort.boundingBox();
  assert.ok(createBounds.x + createBounds.width <= sortBounds.x);
  await page.screenshot({ path: join(output, "sidebar-project-controls.png") });
  await all.click();
  assert.equal(await create.count(), 0);
  await sidebar.getByText("暂无任务", { exact: true }).waitFor();
  assert.equal(
    await sidebar
      .getByText("暂无任务", { exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  await project.click();
  await create.click();
  const groups = sidebar.locator("[data-grouped-group-item-id]");
  await groups.locator("input").waitFor();
  assert.equal(await create.count(), 0);
  assert.equal(await groups.count(), 1);
  assert.equal(
    await groups
      .locator("[data-grouped-empty-drop-zone-id]")
      .evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  await page.keyboard.press("Escape");
  await groups.locator("[data-grouped-group-header-id]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await groups.locator("input").fill("界面验证分组");
  await groups.locator("input").press("Enter");
  await sidebar.getByText("界面验证分组", { exact: true }).first().waitFor();
  await project.click();
  await all.click();
  await groups.waitFor();
  assert.equal(await groups.count(), 1);
  await project.click();
  await sidebar.getByRole("button", { name: "归档", exact: true }).click();
  const archivedEmpty = sidebar.getByText("暂无归档任务", { exact: true });
  await archivedEmpty.waitFor();
  assert.equal(await archivedEmpty.evaluate((el) => getComputedStyle(el).fontSize), "12px");
  assert.equal(await create.count(), 0);
  await sidebar.getByRole("button", { name: "关闭", exact: true }).click();
}

export async function verifyTaskRowRefinement(page, output, failedState = false) {
  await page.evaluate(
    async ({ cwd, failedState }) => {
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
      const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
      const domModule = await import(
        resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
      );
      const React = reactModule.default ?? reactModule;
      const { createRoot } = domModule.default ?? domModule;
      const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
      const { MemoTaskItem } = await load("TaskListItem.tsx");
      const { GroupedTaskRow } = await load("workspace-grouped-tasks/task-row.tsx");
      const { MyCodeIntlProvider, useMyCodeIntl } = await load("i18n/IntlProvider.tsx");
      const { PlatformProvider } = await load("hooks/usePlatform.tsx");
      const { ServiceProvider } = await load("hooks/useServices.tsx");
      const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
      const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
      const { TooltipProvider } = await load("components/ui/tooltip.tsx");
      const host = document.createElement("div");
      host.id = "task-row-refinement-fixture";
      host.className = "workspace-sidebar";
      host.style.cssText =
        "position:fixed;left:16px;top:160px;width:320px;z-index:10000;padding:12px;background:var(--color-sidebar)";
      document.body.append(host);
      const root = createRoot(host);
      const counters = { pin: 0, archive: 0, close: 0, tree: 0, top: 0, rename: 0 };
      const noop = () => {};
      const task = {
        taskId: "row-refinement",
        workspacePath: cwd,
        title: "任务行验证",
        provider: "glm",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: failedState ? "error" : "idle",
        unreadAt: 0,
      };
      function Fixture() {
        const { intl } = useMyCodeIntl();
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { "data-fixture-row": "default" },
            React.createElement(MemoTaskItem, {
              task,
              workspacePath: cwd,
              intl,
              isPinned: false,
              isActive: true,
              isMobileActive: !failedState,
              onSelectTask: noop,
              onArchiveTaskInline: () => counters.archive++,
              onCancelArchiveConfirm: noop,
              isArchiveConfirming: false,
              onTogglePinTask: () => counters.pin++,
              onStartRenameTask: () => counters.rename++,
              onArchiveTask: noop,
              onMarkTaskAsUnread: noop,
              onOpenFileTree: () => counters.tree++,
            }),
          ),
          React.createElement(
            "div",
            { "data-fixture-row": "grouped" },
            React.createElement(GroupedTaskRow, {
              task,
              groups: [],
              dragId: "fixture:grouped",
              activeWorkspacePath: cwd,
              activeTaskId: task.taskId,
              workspaceLabel: "验证",
              onSelectTask: noop,
              onCloseTask: () => counters.close++,
              onMoveTaskToGroup: noop,
              onMoveTaskToTop: () => counters.top++,
              onStartRenameTask: () => counters.rename++,
              onArchiveTask: noop,
              onMarkTaskAsUnread: noop,
              onOpenFileTree: () => counters.tree++,
            }),
          ),
        );
      }
      root.render(
        React.createElement(
          MyCodeIntlProvider,
          { initialLocale: "zh-CN" },
          React.createElement(
            PlatformProvider,
            { platform: {} },
            React.createElement(
              ServiceProvider,
              { services: useRemoteWorkspaceSessionStore.getState().baseServices ?? {} },
              React.createElement(
                TabStoreProvider,
                null,
                React.createElement(TooltipProvider, null, React.createElement(Fixture)),
              ),
            ),
          ),
        ),
      );
      window.__taskRowFixture = { root, host, counters };
    },
    { cwd: process.cwd(), failedState },
  );
  const fixture = page.locator("#task-row-refinement-fixture");
  try {
    const ordinary = fixture.locator('[data-fixture-row="default"]');
    const grouped = fixture.locator('[data-fixture-row="grouped"]');
    await ordinary.getByText("任务行验证", { exact: true }).waitFor();
    if (failedState) {
      for (const time of await fixture.locator("[data-task-time]").all()) {
        assert.equal(await time.evaluate((el) => getComputedStyle(el).fontSize), "13px");
        assert.equal(await time.evaluate((el) => getComputedStyle(el).fontWeight), "400");
      }
      assert.equal(await fixture.locator("[data-error-indicator]").count(), 2);
      for (const icon of await fixture.locator("[data-error-indicator]").all()) {
        assert.equal(await icon.getAttribute("aria-label"), "上次执行失败");
        assert.equal(await icon.getAttribute("stroke-width"), "1.5");
        assert.equal(await icon.locator("title").textContent(), "上次执行失败");
        assert.equal(
          await icon.evaluate((el) => getComputedStyle(el).color.includes("255, 85, 85")),
          false,
        );
      }
      assert.equal(await fixture.locator(".bg-red-500").count(), 0);
      await page.screenshot({ path: join(output, "task-failure-indicator.png") });
      return;
    }
    await ordinary.hover();
    await ordinary.getByRole("button", { name: "置顶", exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await ordinary.getByRole("button", { name: "置顶", exact: true }).count(), 1);
    await ordinary.getByRole("button", { name: "置顶", exact: true }).click();
    const archive = ordinary.getByRole("button", { name: "归档", exact: true });
    const pin = ordinary.getByRole("button", { name: "置顶", exact: true });
    const [pinBox, archiveBox] = await Promise.all([pin.boundingBox(), archive.boundingBox()]);
    assert.ok(pinBox.x + pinBox.width <= archiveBox.x);
    assert.ok((await ordinary.locator("li").boundingBox()).height <= 28);
    await archive.click();
    await ordinary.hover();
    const more = ordinary.getByRole("button", { name: "更多", exact: true });
    const moreBox = await more.boundingBox();
    await more.click();
    const taskMenu = page.locator("[data-sidebar-task-menu]");
    await taskMenu.waitFor();
    const [rowBox, menuBox] = await Promise.all([ordinary.boundingBox(), taskMenu.boundingBox()]);
    assert.ok(menuBox.x >= rowBox.x + rowBox.width - 4);
    assert.ok(Math.abs(menuBox.y - moreBox.y) < 2);
    await page.getByRole("menuitem", { name: "重命名任务", exact: true }).click();
    await grouped.hover();
    const close = grouped.getByRole("button", { name: "关闭", exact: true });
    await close.waitFor();
    assert.equal(await fixture.getByRole("button", { name: /显示文件树|移动到顶部/ }).count(), 0);
    assert.ok(
      (
        await grouped
          .getByRole("button", { name: "任务行验证", exact: false })
          .first()
          .boundingBox()
      ).height <= 26,
    );
    await close.click();
    await grouped.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "重命名任务", exact: true }).click();
    await page.screenshot({ path: join(output, "task-row-refinement.png") });
    await grouped.getByText("任务行验证", { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "移动到分组", exact: true }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "移动到顶部", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    const counters = await page.evaluate(() => window.__taskRowFixture.counters);
    assert.deepEqual(counters, { pin: 1, archive: 1, close: 1, tree: 0, top: 0, rename: 2 });
  } finally {
    await page.evaluate(() => {
      window.__taskRowFixture.root.unmount();
      window.__taskRowFixture.host.remove();
      delete window.__taskRowFixture;
    });
  }
}
