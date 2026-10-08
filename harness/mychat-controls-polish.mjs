import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";
import { mountFooterBarFixture } from "./mycode-footer-bar-fixture.mjs";

export async function mountMyChatControlsFixture(page) {
  const rootSource = await readFile("packages/ui/src/root/RootWorkspaceContent.tsx", "utf8");
  assert.match(rootSource, /import MyChatWorkspace from/);
  assert.equal(rootSource.includes("lazy("), false);
  assert.equal(rootSource.includes("正在载入 MyChat"), false);
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture,
      h = f.h;
    const { App } = await f.load("mychat/chat/App.tsx");
    const { MyChatApiContext } = await f.load("mychat/MyChatApiContext.tsx");
    await f.load("mychat/MyChatWorkspace.tsx");
    const no = () => () => {};
    let finish;
    const pending = new Promise((resolve) => (finish = resolve));
    let saved = {
      language: "zh",
      theme: "dark",
      fontSize: 15,
      model: "Qwen3.8-27B",
      defaultEffort: "xhigh",
      llamaAutoStart: false,
      llamaUrl: "fixture",
      llamaEndpoints: [],
      llamaModels: [
        {
          id: "qwen",
          name: "Qwen3.8-27B",
          endpointId: "fixture",
          reasoningControl: "effort",
          reasoningEfforts: ["none", "low", "medium", "xhigh"],
        },
        {
          id: "deepseek",
          name: "DeepSeek-V4-Pro",
          endpointId: "fixture",
          reasoningControl: "effort",
        },
      ],
    };
    const counts = { folder: 0, search: [], model: [], send: [], refresh: 0 };
    const status = { models: ["Qwen3.8-27B", "DeepSeek-V4-Pro"], running: false };
    const api = {
      models: {
        refreshCatalog: async () => {
          counts.refresh++;
          await pending;
          return { settings: saved, status };
        },
        status: async () => status,
      },
      chats: {
        list: async () => [],
        create: async () => ({ id: "chat-fixture", title: "fixture" }),
        search: async (q) => {
          counts.search.push(q);
          return [];
        },
        messages: async () => [],
        onRenamed: no,
      },
      chat: {
        onDelta: no,
        onDone: no,
        onError: no,
        stop: async () => {},
        send: async (request) => {
          counts.send.push(request);
          return { userId: "fixture-user", assistantId: "fixture-assistant" };
        },
      },
      screenshot: { onAdded: no },
      ui: { onNewChat: no, onSettings: no, onSearch: no, onStop: no },
      settings: {
        set: async (patch) => {
          counts.model.push(patch.model);
          saved = { ...saved, ...patch };
          return saved;
        },
      },
      attachments: {
        pickFilesAndFolders: async () => {
          counts.folder++;
          return [
            {
              id: "folder",
              name: "fixture-folder",
              path: "/fixture/folder",
              kind: "file",
              mime: "text/plain",
              relativePath: "folder/item.txt",
            },
          ];
        },
      },
    };
    let active = true;
    const render = () =>
      f.render({
        empty: true,
        onlyExtra: true,
        extra: h(
          "div",
          {
            "data-chat-polish": "",
            className: "mychat-surface",
            style: { position: "fixed", inset: 0, zIndex: 50, display: active ? "block" : "none" },
          },
          h(
            MyChatApiContext.Provider,
            { value: api },
            h(App, {
              active,
              sharedPreferences: { theme: "dark", fontSize: 16 },
              chromeOptions: {
                workspacePath: "/fixture/default",
                isDesktop: true,
                isMacDesktop: true,
                isWindowsDesktop: false,
                frameClassName: "",
                platform: {},
                chrome: {
                  isMacFullscreen: false,
                  macWindowControlsLeftPaddingPx: 96,
                  updateReadyVersion: null,
                  updateState: null,
                  desktopWindowChromeState: {},
                },
              },
            }),
          ),
        ),
      });
    window.__chatPolish = {
      counts,
      finish,
      render,
      toggle: () => {
        active = !active;
        render();
      },
    };
    render();
  });
}

export async function verifyMyChatControlsPolish(page, output) {
  await mountMyChatControlsFixture(page);
  const chat = page.locator("[data-chat-polish]");
  await chat.getByPlaceholder("向 MyChat 提问...").waitFor();
  assert.equal(await chat.locator(".loading-screen").count(), 0);
  assert.equal(await chat.getByText("正在载入 MyChat", { exact: true }).count(), 0);
  assert.equal(await chat.locator("textarea").isDisabled(), true);
  await chat.screenshot({ path: join(output, "cold-switch.png") });
  await page.evaluate(() => window.__chatPolish.finish());
  await page.waitForFunction(() => !document.querySelector("[data-chat-polish] textarea").disabled);
  assert.equal(await chat.locator(".picker-model-name").innerText(), "Qwen3.8-27B");
  assert.equal(await chat.locator(".picker-trigger [data-model-logo]").count(), 1);
  const search = chat.locator('[data-testid="desktop-top-search"]');
  await search.waitFor();
  const sidebar = chat.locator('[data-testid="mychat-sidebar"]');
  assert.equal(await sidebar.getByRole("button", { name: "搜索", exact: true }).count(), 0);
  const sb = await sidebar.boundingBox(),
    ss = await search.boundingBox();
  assert.ok(ss.y < 48 && ss.x > sb.x + sb.width / 2 && ss.x + ss.width <= sb.x + sb.width + 1);
  await search.click();
  const input = chat.getByPlaceholder("搜索历史会话...");
  await input.fill("needle");
  await page.waitForFunction(() => window.__chatPolish.counts.search.includes("needle"));
  await chat.getByRole("button", { name: "关闭搜索", exact: true }).click();
  await chat.locator("textarea").fill("保留草稿");
  await page.evaluate(() => window.__chatPolish.toggle());
  await page.evaluate(() => window.__chatPolish.toggle());
  assert.equal(await chat.locator("textarea").inputValue(), "保留草稿");
  assert.equal(await page.evaluate(() => window.__chatPolish.counts.refresh), 1);
  const add = chat.locator(".attachment-trigger");
  await add.click();
  await page.getByRole("menuitemcheckbox", { name: "全网检索", exact: true }).click();
  await page.locator(".mychat-attachment-menu").waitFor({ state: "hidden" });
  await add.click();
  assert.equal(
    await page
      .getByRole("menuitemcheckbox", { name: "全网检索", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  const attachmentMenu = page.locator(".mychat-attachment-menu");
  await attachmentMenu.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const attachmentRows = await attachmentMenu
    .getByRole("menuitem")
    .or(attachmentMenu.getByRole("menuitemcheckbox"))
    .evaluateAll((rows) =>
      rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        font: getComputedStyle(row).fontSize,
        weight: getComputedStyle(row).fontWeight,
      })),
    );
  assert.equal(attachmentRows.length, 2);
  for (const row of attachmentRows) {
    assert.equal(row.height, 28);
    assert.equal(row.font, "15px");
    assert.equal(row.weight, "400");
  }
  await attachmentMenu.screenshot({ path: join(output, "attachment-menu.png") });
  await page.getByRole("menuitem", { name: "添加文件或文件夹", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__chatPolish.counts.folder), 1);
  assert.equal(await chat.locator(".composer-bar > .left-tools > .icon-chip").count(), 0);
  await chat.locator(".picker-trigger").click();
  await chat.getByRole("button", { name: "模型", exact: true }).click();
  await chat.getByRole("button", { name: "DeepSeek-V4-Pro", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-chat-polish] .picker-model-name").textContent ===
      "DeepSeek-V4-Pro",
  );
  assert.equal(
    await page.evaluate(() => window.__chatPolish.counts.model.includes("DeepSeek-V4-Pro")),
    true,
  );
  await chat.locator("textarea").click();
  await chat.locator(".picker-panel").waitFor({ state: "hidden" });
  const metrics = [];
  for (const theme of ["mycode-dark", "mycode-light"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => document.querySelector("[data-chat-polish] .composer"));
      const m = await chat.evaluate((el) => {
        const composer = el.querySelector(".composer"),
          area = composer.querySelector("textarea"),
          plus = composer.querySelector(".attachment-trigger svg"),
          name = composer.querySelector(".picker-model-name"),
          arrow = composer.querySelector(".chev"),
          trigger = composer.querySelector(".picker-trigger");
        const box = (n) => n.getBoundingClientRect();
        const greeting = el.querySelector('[data-testid="mychat-welcome-title"]');
        return {
          width: innerWidth,
          plusOffset: box(plus).left - box(area).left,
          arrowDisplay: getComputedStyle(arrow).display,
          separator: getComputedStyle(composer.querySelector(".picker-effort-tag"), "::before")
            .content,
          modelLogoWidth: box(trigger.querySelector("[data-model-logo]")).width,
          plusWidth: box(plus).width,
          greetingSize: getComputedStyle(greeting).fontSize,
          greetingWeight: getComputedStyle(greeting).fontWeight,
          logoWidth: box(el.querySelector('[data-testid="mychat-welcome-logo"]')).width,
          inputWeight: getComputedStyle(area).fontWeight,
          overflow:
            box(composer).right > innerWidth + 1 || composer.scrollWidth > composer.clientWidth,
          nameFont: getComputedStyle(name).fontSize,
          nameHeight: box(name).height,
        };
      });
      assert.ok(Math.abs(m.plusOffset) <= 1, JSON.stringify(m));
      assert.equal(m.arrowDisplay, "none");
      assert.equal(m.separator, '"·"');
      assert.equal(m.modelLogoWidth, 18);
      assert.equal(m.plusWidth, 16);
      assert.equal(m.logoWidth, 48);
      assert.equal(m.greetingWeight, "400");
      assert.equal(m.inputWeight, "400");
      assert.equal(m.nameHeight, 15);
      assert.equal(m.overflow, false, JSON.stringify(m));
      metrics.push({ theme, ...m });
      await chat.screenshot({ path: join(output, `chat-${width}-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  assert.equal(await chat.getByTestId("desktop-top-new-task").count(), 0);
  if (await chat.locator(".sidebar.collapsed").count()) {
    await chat.getByTestId("desktop-top-sidebar-toggle").click();
    await chat.locator(".sidebar:not(.collapsed)").waitFor();
  }
  await chat.getByTestId("desktop-top-sidebar-toggle").click();
  await chat.locator(".sidebar.collapsed").waitFor();
  const rail = chat.locator(".sidebar.collapsed [data-size='icon-md']");
  assert.equal(await rail.count(), 2);
  const railIcons = await rail.locator("svg").evaluateAll((nodes) =>
    nodes.map((n) => ({
      width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height,
    })),
  );
  assert.ok(
    railIcons.every((n) => n.width === 20 && n.height === 20),
    JSON.stringify(railIcons),
  );
  assert.equal(await sidebar.getByRole("button", { name: "展开侧边栏", exact: true }).count(), 0);
  await chat.screenshot({ path: join(output, "mychat-collapsed-rail.png") });
  await sidebar.getByRole("button", { name: "搜索", exact: true }).click();
  await chat.locator(".sidebar:not(.collapsed)").waitFor();
  await chat.getByRole("button", { name: "关闭搜索", exact: true }).click();
  await chat.locator(".picker-trigger").click();
  const panel = chat.locator(".picker-panel");
  assert.equal((await panel.boundingBox()).width, 220);
  assert.equal(
    await panel
      .locator(".picker-row")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
    28,
  );
  await panel.screenshot({ path: join(output, "model-menu.png") });
  await chat.locator("textarea").click();
  await chat.locator(".send").click();
  await page.waitForFunction(() => window.__chatPolish.counts.send.length === 1);
  const sent = await page.evaluate(() => window.__chatPolish.counts.send[0]);
  assert.equal(sent.content, "保留草稿");
  assert.equal(sent.webSearch, true);
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.attachments[0].path, "/fixture/folder");
  await chat.screenshot({ path: join(output, "chat-sent.png") });
  // 验证 MyCode 的加号与原输入起点，以及共享欢迎区的尺寸。
  await mountFooterBarFixture(page);
  const bar = page.locator("[data-footer-bar-fixture]");
  const code = await bar.evaluate((el) => {
    const plus = el.querySelector("[data-composer-add] svg");
    const placeholder = el.querySelector("[data-composer-placeholder]");
    const arrow = el.querySelector(".composer-model-trigger [data-bar-chevron]");
    return {
      offset: plus.getBoundingClientRect().left - placeholder.getBoundingClientRect().left,
      height: el.querySelector("[data-composer-add]").getBoundingClientRect().height,
      arrowDisplay: getComputedStyle(arrow).display,
    };
  });
  assert.ok(Math.abs(code.offset - (7 * 16) / 15) <= 1, JSON.stringify(code));
  assert.ok(Math.abs(code.height - (28 * 16) / 15) < 0.1);
  assert.equal(code.arrowDisplay, "none");
  await bar.locator(".composer-model-trigger").click();
  const codeMenu = page.locator('.composer-model-menu[data-slot="dropdown-menu-content"]');
  await codeMenu.waitFor();
  await codeMenu.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const menuMetrics = await codeMenu.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    rows: [...el.querySelectorAll('[role="menuitemradio"],[role="menuitem"]')].map((row) => ({
      height: row.getBoundingClientRect().height,
      font: getComputedStyle(row).fontSize,
    })),
    icons: [...el.querySelectorAll("svg")].map((icon) => icon.getBoundingClientRect().width),
  }));
  assert.equal(menuMetrics.width, 224);
  assert.ok(menuMetrics.rows.length > 0);
  for (const row of menuMetrics.rows) {
    assert.equal(row.height, 28);
    assert.equal(row.font, "15px");
  }
  assert.ok(menuMetrics.icons.every((width) => width === 14));
  await codeMenu.screenshot({ path: join(output, "mycode-model-menu.png") });
  await codeMenu.getByRole("menuitemradio").first().click();
  assert.equal(await page.evaluate(() => window.__footerBarFixture.counts.model), 1);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationDraftEmptyState } = await f.load("v4/ConversationDraftEmptyState.tsx");
    f.render({
      empty: true,
      onlyExtra: true,
      extra: f.h(
        "div",
        { className: "conversation-reference-surface" },
        f.h(ConversationDraftEmptyState),
      ),
    });
  });
  assert.equal(
    await page
      .locator('[data-testid="v4-draft-brand"]')
      .evaluate((el) => el.getBoundingClientRect().width),
    48,
  );
  assert.equal(
    await page
      .locator('[data-testid="v4-draft-greeting"]')
      .evaluate((el) => getComputedStyle(el).fontWeight),
    "400",
  );
  assert.equal(
    await page
      .locator('[data-testid="v4-draft-greeting"]')
      .evaluate((el) => getComputedStyle(el).fontSize),
    "26.6667px",
  );
  await page
    .locator('[data-testid="v4-draft-greeting"]')
    .screenshot({ path: join(output, "mycode-greeting.png") });
  return { passed: true, metrics, railIcons, code, menuMetrics, attachmentRows, sent };
}
