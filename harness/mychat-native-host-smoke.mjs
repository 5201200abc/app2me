import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyNativeMyChatMode(page, cwd, settings, output) {
  const myCode = page.locator('[data-root-workspace-surface="interactive"]');
  // 经真实 Renderer 服务访问器调用原生 Host，不使用测试注入的 MyChat 服务。
  await page.evaluate(
    async ({ cwd, settings }) => {
      const { useRemoteWorkspaceSessionStore } = await import(
        `/@fs${cwd}/packages/ui/src/store/remoteWorkspaceSessionStore.ts`
      );
      const service = useRemoteWorkspaceSessionStore.getState().baseServices?.myChatService;
      if (!service) throw new Error("原生 MyChat 服务未注册");
      await service.call({ command: "settings:set", args: [settings] });
    },
    { cwd, settings },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await myCode.locator("[data-testid=v4-draft-brand].tabler-icon-terminal").waitFor();
  const codeEmpty = await myCode.evaluate((root) => {
    const box = (selector) => root.querySelector(selector).getBoundingClientRect().toJSON();
    const greeting = root.querySelector("[data-v4-draft-greeting]");
    return {
      sidebar: box(".workspace-sidebar"),
      brand: box("[data-testid=v4-draft-brand]"),
      dock: box("[data-v4-composer-dock-content]"),
      composer: box("[data-prompt-editor-shell]"),
      greeting: {
        size: getComputedStyle(greeting).fontSize,
        weight: getComputedStyle(greeting).fontWeight,
      },
    };
  });
  await page.screenshot({ path: join(output, "mycode-empty-layout.png") });
  const hostAppearance = await myCode
    .locator(".conversation-reference-surface")
    .first()
    .evaluate((surface) => {
      const style = getComputedStyle(surface);
      const composer = surface.querySelector("[data-prompt-editor-shell]");
      const composerStyle = getComputedStyle(composer);
      return {
        background: style.backgroundColor,
        color: style.getPropertyValue("--conversation-text").trim(),
        font: style.fontFamily,
        composerBackground: composerStyle.backgroundColor,
        composerRadius: composerStyle.borderRadius,
        composerFont: composerStyle.fontFamily,
      };
    });
  await myCode.getByRole("button", { name: "MyCode", exact: true }).click();
  for (const name of ["语言设置", "主题外观", "缩放比例", "布局模式"])
    assert.equal(await page.getByRole("menuitem", { name, exact: true }).count(), 1);
  await page.getByRole("menuitem", { name: "布局模式" }).hover();
  await page.getByRole("menuitemradio", { name: "MyChat", exact: true }).waitFor();
  assert.deepEqual(await page.getByRole("menuitemradio").allTextContents(), ["MyChat", "MyCode"]);
  await page.getByRole("menuitemradio", { name: "MyChat", exact: true }).click();
  const chat = page.locator(".mychat-surface");
  const input = chat.getByPlaceholder("向 MyChat 提问...");
  await input.waitFor();
  const chatEmpty = await chat.evaluate((root) => {
    const box = (selector) => root.querySelector(selector).getBoundingClientRect().toJSON();
    const greeting = root.querySelector("[data-testid=mychat-welcome-title]");
    const header = root.querySelector(".mychat-workspace-header");
    return {
      sidebar: box(".workspace-sidebar"),
      brand: box("[data-testid=mychat-welcome-logo]"),
      dock: box(".composer-wrap"),
      composer: box(".composer"),
      greeting: {
        size: getComputedStyle(greeting).fontSize,
        weight: getComputedStyle(greeting).fontWeight,
      },
      headerText: header.innerText.trim(),
      highlighted: root
        .querySelector("[data-testid=task-new-button]")
        ?.classList.contains("bg-selected"),
      toolbar: [...root.querySelector(".left-tools").children].map((el) => el.className),
      pageWidth: root.scrollWidth,
    };
  });
  assert.equal(chatEmpty.sidebar.width, codeEmpty.sidebar.width);
  assert.equal(chatEmpty.brand.width, codeEmpty.brand.width);
  assert.equal(chatEmpty.composer.width, codeEmpty.composer.width);
  assert.deepEqual(chatEmpty.greeting, codeEmpty.greeting);
  assert.equal(chatEmpty.headerText, "");
  assert.ok(
    Math.abs(chatEmpty.brand.y - codeEmpty.brand.y) <= 8,
    JSON.stringify({ codeEmpty, chatEmpty }),
  );
  assert.ok(
    Math.abs(chatEmpty.dock.y - codeEmpty.dock.y) <= 8,
    JSON.stringify({ codeEmpty, chatEmpty }),
  );
  assert.equal(await chat.locator(".left-tools > .picker").count(), 1);
  assert.equal(await chat.locator(".right-tools > .picker").count(), 0);
  const left = chat.locator(".left-tools");
  assert.ok(await left.locator(":scope > .picker").count());
  assert.ok(await chat.locator("[data-testid=task-new-button].bg-selected").count());
  for (const forbidden of ["选择项目", "完全访问", "远程连接", "自动化", "插件"])
    assert.ok(!(await chat.innerText()).includes(forbidden));
  await chat.getByRole("button", { name: "全网检索", exact: true }).click();
  assert.equal(
    await chat.getByRole("button", { name: "全网检索", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await chat.getByRole("button", { name: "全网检索", exact: true }).click();
  await chat.getByRole("button", { name: "展开侧边面板", exact: true }).click();
  await chat.locator(".settings-stage").waitFor();
  await chat.getByRole("button", { name: /返回|Back/ }).click();
  await page.screenshot({ path: join(output, "mychat-empty-layout.png") });
  const desktopGeometry = { codeEmpty, chatEmpty };
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await chat.evaluate((root) => root.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, "mychat-empty-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await input.fill("原生 Host 流式验证");
  await chat.getByRole("button", { name: "发送", exact: true }).click();
  await chat.getByText("MyChat 已完成流式回复。", { exact: true }).waitFor();
  await input.fill("原生模式保留草稿");
  const appearance = await chat.locator(".conversation-reference-surface").evaluate((surface) => {
    const style = getComputedStyle(surface);
    const composer = surface.querySelector("[data-prompt-editor-shell]");
    const composerStyle = getComputedStyle(composer);
    return {
      background: style.backgroundColor,
      color: style.getPropertyValue("--conversation-text").trim(),
      font: style.fontFamily,
      composerBackground: composerStyle.backgroundColor,
      composerRadius: composerStyle.borderRadius,
      composerFont: composerStyle.fontFamily,
    };
  });
  assert.deepEqual(appearance, hostAppearance);
  assert.equal(
    await chat
      .locator(".mychat-workspace-header")
      .evaluate((el) => el.getBoundingClientRect().height),
    48,
  );
  assert.equal(
    await chat.locator(".thread-inner").evaluate((el) => el.getBoundingClientRect().width),
    await chat.locator(".composer").evaluate((el) => el.getBoundingClientRect().width),
  );
  assert.equal(
    await chat.locator(".composer-wrap").evaluate((el) => getComputedStyle(el).paddingTop),
    "24px",
  );
  assert.equal(
    await chat.locator(".composer .send").evaluate((el) => el.getBoundingClientRect().width),
    32,
  );
  assert.equal(
    await chat.locator(".user-bubble").evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  assert.equal(
    await chat.locator(".composer .send").evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  await page.screenshot({ path: join(output, "native-host-chat.png") });
  await chat.getByRole("button", { name: "MyChat", exact: true }).click();
  await page.getByRole("menuitem", { name: "布局模式" }).hover();
  await page.getByRole("menuitemradio", { name: "MyCode", exact: true }).click();
  await page.getByTestId("composer-model-controls").waitFor();
  // 手机宽度会按宿主现有规则收起 MyCode 侧栏；返回桌面后用真实按钮展开。
  await myCode.getByRole("button", { name: "切换侧边栏", exact: true }).click();
  await myCode.getByRole("button", { name: "MyCode", exact: true }).click();
  await page.getByRole("menuitem", { name: "布局模式" }).hover();
  await page.getByRole("menuitemradio", { name: "MyChat", exact: true }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), "原生模式保留草稿");
  assert.equal(await page.evaluate(() => localStorage.getItem("mycode-interface-mode")), "mychat");
  // 隔离后续组件场景；完整主界面与 Host 已验证，关闭 Electron 时统一释放。
  await page.evaluate(() => {
    document.getElementById("root").style.display = "none";
  });
  return { passed: true, emptyLayout: desktopGeometry };
}
