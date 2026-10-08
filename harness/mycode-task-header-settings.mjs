import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const descriptions = [
  "设置后，模型请求、MCP、命令工具和应用界面层的网络流量都经由这个代理，不读取系统的代理环境变量。没有填写则这些流量直接联网，只有内置浏览器仍跟随系统代理。修改后需重启应用。",
  "这些主机的请求直接连接，不经过上面的 HTTP 代理。多个规则用英文逗号分隔，修改后需重启应用。",
  "可选，适用于公司网络或代理使用自签名证书的情况。填入 PEM 格式根证书的文件路径后，该证书会通过 NODE_EXTRA_CA_CERTS 传给模型、MCP 和命令工具，同时用于应用界面层的证书校验。修改后需重启应用。",
  "用显卡加速界面显示。如果出现白屏、闪退或显示异常，可以关闭，避开部分显卡或驱动的兼容问题。修改后需重启应用。",
  "开启后，会比普通用户更早收到预览版，最先体验新功能和改进。关闭则按正式发布的节奏收到更新。",
  "开启后，检测到更新就自动下载。下载完成后，如果有任务正在运行，重启更新前仍会让你确认。",
  "任务完成、失败或需要你确认时，发送桌面通知。",
  "任务通知开启时，可以单独关闭通知的提示音。",
  "开启后，系统不会因为空闲而自动休眠，但你仍可手动睡眠或合盖休眠。该设置对整个桌面端生效。",
  "MyCode 正在运行任务时，你又发出新指令，选“队列”就让新指令排队，等当前任务结束后再执行。另一种选项是插入到当前任务的下一轮工具调用之后执行。",
  "开启后，Agent 向你提问，5 分钟没回答就自动往下继续。关闭后，当前和之后的提问都一直等你回答。",
  "完整保存发给模型的请求和模型返回的响应，不压缩、不限制大小、不删除旧记录，占用空间会越来越大。",
  "开启后，消息流里显示模型完整的思考内容。关闭后，每一轮只显示第一次思考。",
  "在消息流中显示 Agent 的待办清单卡片。",
  "把连续的读取、搜索类工具调用合并成一个“Explore”分组显示。",
  "把连续的非只读 Shell 命令合并成一个“Terminal”分组显示。",
  "把连续的 Write、Edit、ApplyPatch 调用合并成一个“Changes”分组显示。",
  "开启后，定期扫描最近打开过的工作区，自动归档同时满足以下条件的任务：已完成、没有未读消息、未置顶、超过保留时长。",
  "应用数据存放的根目录，默认是用户主目录。修改后，现有数据会复制到新位置。实际数据位于所选目录下的 .mycode/v2，这段后缀固定，不能改。",
];

export async function verifyGeneralDescriptions(page, output) {
  const settings = page.getByTestId("settings-page");
  await settings.getByRole("button", { name: "常规", exact: true }).click();
  for (const text of descriptions) await settings.getByText(text, { exact: true }).waitFor();
  await settings
    .getByPlaceholder("localhost,127.0.0.1,::1,.example.com,*.corp.com", { exact: true })
    .waitFor();
  await settings.getByPlaceholder("/Users/name/certs/root-ca.pem", { exact: true }).waitFor();
  const description = (days) =>
    `任务最后更新时间早于这个时长，才会被自动归档，当前是 ${days} 天。上一项关闭时该选项为灰色，不生效。`;
  const archive = settings
    .getByText("自动归档旧任务", { exact: true })
    .locator("xpath=ancestor::div[.//*[@role='switch']][1]")
    .getByRole("switch");
  const retentionRow = settings
    .getByText("归档保留时长", { exact: true })
    .locator("xpath=ancestor::div[.//*[@role='combobox']][1]");
  const retention = retentionRow.getByRole("combobox");
  const initial = await archive.getAttribute("aria-checked");
  const days = (await retention.innerText()).match(/\d+/)[0];
  await settings.getByText(description(days), { exact: true }).waitFor();
  if (initial !== "true") await archive.click();
  await page.waitForFunction((el) => !el.disabled, await retention.elementHandle());
  await retention.click();
  await page.getByRole("option", { name: "14 天后归档", exact: true }).click();
  await settings.getByText(description(14), { exact: true }).waitFor();
  await retention.click();
  await page.getByRole("option", { name: `${days} 天后归档`, exact: true }).click();
  await settings.getByText(description(days), { exact: true }).waitFor();
  if (initial !== "true") {
    await archive.click();
    await page.waitForFunction((el) => el.disabled, await retention.elementHandle());
  }
  assert.equal(await retention.isDisabled(), initial !== "true");
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await settings.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    await page.screenshot({ path: join(output, `settings-descriptions-${width}.png`) });
  }
}

export async function verifyTaskHeaderRefinement(page, output) {
  await page.evaluate(async (cwd) => {
    const resources = performance.getEntriesByType("resource").map((e) => e.name);
    const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(
      resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
    );
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
    const { WorkspaceHeaderTitleSection } = await load("WorkspaceHeaderSections.tsx");
    const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
    const { PlatformProvider } = await load("hooks/usePlatform.tsx");
    const { ServiceProvider } = await load("hooks/useServices.tsx");
    const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
    const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
    const { TooltipProvider } = await load("components/ui/tooltip.tsx");
    const host = document.createElement("div");
    host.id = "header-refinement-fixture";
    host.style.cssText =
      "position:fixed;inset:0;z-index:50;background:var(--color-background);padding:24px;color:var(--color-foreground)";
    document.body.append(host);
    const root = createRoot(host);
    const task = {
      taskId: "header-refinement",
      workspacePath: cwd,
      title: "任务菜单验证",
      provider: "glm",
      status: "idle",
      createdAt: Date.now(),
      updatedAt: Date.now() - 3600000,
      unreadAt: 0,
    };
    const header = React.createElement(
      "div",
      { className: "flex items-center gap-2" },
      React.createElement(WorkspaceHeaderTitleSection, {
        variant: "task",
        workspaceAbsPath: cwd,
        projectName: "project-with-a-long-name-to-check-wrapping-and-containment",
        activeTaskTitle: task.title,
        activeTaskId: task.taskId,
        activeSessionId: task.taskId,
        activeTaskProvider: "glm",
        resolvedActiveTaskMeta: task,
        gitSummary: { isRepository: false },
        workspaceHeaderState: { selectedProvider: "glm" },
        compact: true,
        onRefreshGit: () => {},
      }),
    );
    root.render(
      React.createElement(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        React.createElement(
          PlatformProvider,
          { platform: {} },
          React.createElement(
            ServiceProvider,
            { services: useRemoteWorkspaceSessionStore.getState().baseServices },
            React.createElement(
              TabStoreProvider,
              null,
              React.createElement(TooltipProvider, null, header),
            ),
          ),
        ),
      ),
    );
    window.__headerRefinement = { root, host };
  }, process.cwd());
  const fixture = page.locator("#header-refinement-fixture");
  try {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await fixture.getByTestId("workspace-more-button").click();
      const menu = page.locator("[data-workspace-task-menu]");
      await menu.waitFor();
      await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const appearance = await menu.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        rows: [...el.querySelectorAll("[role=menuitem]")].map((row) => ({
          height: row.getBoundingClientRect().height,
          font: getComputedStyle(row).fontSize,
        })),
      }));
      assert.equal(appearance.width, 176);
      assert.ok(appearance.rows.length >= 10);
      assert.ok(
        appearance.rows.every((row) => row.height === 26 && row.font === "12px"),
        JSON.stringify(appearance),
      );
      for (const name of ["重命名任务", "归档", "标记为未读", "复制路径", "复制会话 ID"])
        await menu.getByRole("menuitem", { name, exact: true }).waitFor();
      await page.keyboard.press("ArrowDown");
      assert.equal(await menu.locator("[data-highlighted]").count(), 1);
      await page.screenshot({ path: join(output, `task-header-menu-${width}.png`) });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      await fixture.getByTestId("workspace-path").click();
      // Radix 为无障碍描述复制 tooltip 子树；测量只取可见内容。
      const info = page.locator(
        '[data-slot="tooltip-content"] > span > [data-workspace-header-context-info]',
      );
      await info.waitFor();
      const popup = info.locator("xpath=ancestor::*[@data-slot='tooltip-content']");
      await popup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      await info.locator("[data-workspace-context-path]").waitFor();
      await info.locator("[data-workspace-last-activity]").waitFor();
      const geometry = await popup.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const info = el.querySelector("[data-workspace-header-context-info]");
        return {
          width: box.width,
          left: box.left,
          right: box.right,
          padding: getComputedStyle(el).paddingLeft,
          font: getComputedStyle(info).fontSize,
          overflow: el.scrollWidth > el.clientWidth + 1,
          activityFont: getComputedStyle(info.querySelector("[data-workspace-last-activity]"))
            .fontSize,
          icons: [...info.querySelectorAll("svg")].map((svg) => ({
            width: svg.getBoundingClientRect().width,
            stroke: svg.getAttribute("stroke-width"),
          })),
        };
      });
      assert.equal(geometry.width, 256);
      assert.equal(geometry.padding, "10px");
      assert.equal(geometry.font, "12px");
      assert.equal(geometry.activityFont, "11px");
      assert.ok(geometry.icons.every((icon) => icon.width === 14 && icon.stroke === "1.5"));
      assert.ok(
        geometry.left >= 0 && geometry.right <= width && !geometry.overflow,
        JSON.stringify(geometry),
      );
      await page.screenshot({ path: join(output, `task-header-context-${width}.png`) });
      await page.keyboard.press("Escape");
      await info.waitFor({ state: "detached" });
    }
    await fixture.getByTestId("workspace-more-button").click();
    const rename = page.getByRole("menuitem", { name: "重命名任务", exact: true });
    await page.waitForFunction(
      (el) => el.getAttribute("data-disabled") === null,
      await rename.elementHandle(),
    );
    await rename.click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
  } finally {
    await page.evaluate(() => {
      window.__headerRefinement.root.unmount();
      window.__headerRefinement.host.remove();
      delete window.__headerRefinement;
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}

export async function verifyHomePresentation(page, output) {
  const homeGeometry = await page.evaluate(() => {
    const sidebar = document.querySelector("[data-workspace-sidebar-panel]");
    const title = document.querySelector("[data-v4-draft-greeting]");
    const brand = document.querySelector('[data-testid="v4-draft-brand"]');
    const shell = document.querySelector("[data-prompt-editor-shell]");
    return {
      sidebar: sidebar.getBoundingClientRect().width,
      navigationFont: getComputedStyle(
        document.querySelector('.workspace-sidebar [data-size="lg"]'),
      ).fontSize,
      title: { size: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight },
      brand: {
        width: brand.getBoundingClientRect().width,
        opacity: getComputedStyle(brand).opacity,
      },
      composer: shell.getBoundingClientRect().width,
      radius: getComputedStyle(shell).borderRadius,
      avatar: document
        .querySelector('.workspace-sidebar-footer [data-slot="avatar"]')
        .getBoundingClientRect().width,
    };
  });
  assert.equal(homeGeometry.sidebar, 240);
  assert.equal(homeGeometry.navigationFont, "13px");
  assert.equal(homeGeometry.title.size, "21px");
  assert.equal(homeGeometry.title.weight, "500");
  assert.equal(homeGeometry.brand.width, 40);
  assert.ok(Number(homeGeometry.brand.opacity) <= 0.5);
  assert.ok(homeGeometry.composer <= 680);
  assert.equal(homeGeometry.radius, "16px");
  assert.equal(homeGeometry.avatar, 22);
  assert.equal(await page.getByText("No projects", { exact: true }).count(), 0);
  await page.getByText("暂无项目", { exact: true }).waitFor();
  const projectGeometry = await page.getByTestId("composer-workspace-trigger").evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    font: getComputedStyle(el).fontSize,
    icon: el.querySelector("svg").getBoundingClientRect().width,
  }));
  assert.deepEqual(projectGeometry, { height: 28, font: "12px", icon: 14 });
  await writeFile(join(output, "home-geometry.json"), JSON.stringify(homeGeometry, null, 2));
  return homeGeometry;
}
