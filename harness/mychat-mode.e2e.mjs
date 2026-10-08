import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer as createHttpServer } from "node:http";
import { _electron } from "playwright-core";
import { createServer } from "vite";
import { createTerminalService } from "../packages/services/src/terminal/terminalService.ts";
import { createMyChatService } from "../packages/services/src/mychat/runtime/runtime.ts";
import { selectDesktopRenderer, prepareDesktopUi } from "./mycode-compact-ui-start.mjs";
import { mountMyChatFixture } from "./mychat-mode-fixture.mjs";
import { verifyWriteIconPolish } from "./mycode-write-icon-polish.mjs";
import { verifyGoalThreadsAndSpacing } from "./mycode-goal-thread-ui.mjs";
import { verifyNativeMyChatMode } from "./mychat-native-host-smoke.mjs";
import { verifyReasoningAndTerminalSummaries } from "./mycode-reasoning-terminal-summary.mjs";
const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "mychat-mode-ui-"));
const output = resolve(".artifacts/mychat-mode");
await mkdir(output, { recursive: true });
const model = createHttpServer(async (request, response) => {
  if (request.url === "/health") return void response.end("{}");
  if (request.url === "/v1/models")
    return void response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
  if (request.url === "/props")
    return void response.end(JSON.stringify({ model_alias: "fixture-model" }));
  if (request.url === "/v1/chat/completions") {
    const data = [];
    for await (const chunk of request) data.push(chunk);
    const payload = JSON.parse(Buffer.concat(data).toString());
    assert.equal(payload.model, "fixture-model");
    if (!payload.stream)
      return void response.end(
        JSON.stringify({ choices: [{ message: { content: "界面模式验证" } }] }),
      );
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"reasoning_content":"正在验证共享设置"}}]}\n\n');
    const timer = setTimeout(() => {
      response.write(
        'data: {"choices":[{"delta":{"content":"MyChat 已完成流式回复。\\n\\n```js\\nconst answer = 42;\\n```"}}]}\n\n',
      );
      response.end("data: [DONE]\n\n");
    }, 700);
    response.once("close", () => clearTimeout(timer));
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const backend = createMyChatService(join(root, "fixture-chat"));
const port = model.address().port;
await mkdir(join(root, "models"));
// 使用有效的最小 GGUF 元数据，让真实模型刷新保留本地测试模型。
const gguf = Buffer.alloc(24);
gguf.write("GGUF");
gguf.writeUInt32LE(3, 4);
await writeFile(join(root, "models", "fixture-model.gguf"), gguf);
const settingsPatch = {
  llamaUrl: `http://127.0.0.1:${port}/v1`,
  model: "fixture-model",
  modelsDir: join(root, "models"),
  llamaAutoStart: false,
  language: "zh",
  llamaModels: [
    {
      id: "fixture",
      name: "fixture-model",
      endpointId: "local",
      reasoningControl: "none",
      source: "remote",
    },
  ],
};
await backend.call({ command: "settings:set", args: [settingsPatch] });
const server = await createServer({
  root: resolve("packages/desktop/src/renderer"),
  configFile: resolve("packages/desktop/vite.config.ts"),
  optimizeDeps: {
    include: [
      "@pierre/diffs/worker/worker.js",
      "react-markdown",
      "remark-gfm",
      "@xterm/xterm",
      "@xterm/addon-fit",
    ],
  },
  server: { port: 5186, strictPort: true },
});
const terminalOwner = createTerminalService({
  settingService: { get: async () => ({ terminalInheritSystemProfile: false }) },
});
const terminalSubscriptions = [];
let app, page;
let passed = false;
const errors = [];
const desktopOutput = [];
let sub;
try {
  await server.listen();
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [resolve("packages/desktop")],
    env: {
      ...process.env,
      MYCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      MYCODE_DESKTOP_APPLICATION_NAME: `MyChat Mode E2E ${process.pid}`,
      MYCODE_DESKTOP_HOME_DIR: root,
      MYCODE_DESKTOP_USER_DATA_DIR: join(root, "electron"),
      MYCODE_DESKTOP_SESSION_DATA_DIR: join(root, "electron-session"),
      MYCODE_DATA_BASE_DIR: root,
      MYCODE_STORAGE_DIR: join(root, ".mycode"),
      MYCODE_SESSION_DB_PATH: join(root, "cli.sqlite"),
      ELECTRON_RENDERER_URL: "http://localhost:5186",
    },
  });
  app.process().stdout?.on("data", (x) => desktopOutput.push(String(x)));
  app.process().stderr?.on("data", (x) => desktopOutput.push(String(x)));
  page = await selectDesktopRenderer(app);
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  await prepareDesktopUi(page, false);
  const nativeHostProof = await verifyNativeMyChatMode(page, process.cwd(), settingsPatch, output);
  await page.exposeFunction("__mychatCall", (request) => backend.call(request));
  await page.exposeFunction("__mychatTerminalCall", async (command, params) => {
    assert.ok(["create", "write", "resize", "dispose"].includes(command));
    const result = await terminalOwner[command](params);
    if (command === "create")
      for (const kind of ["Data", "Exit"])
        terminalSubscriptions.push(
          terminalOwner[`onDynamic${kind}`](result.id)((data) => {
            void page
              .evaluate(
                (detail) =>
                  window.dispatchEvent(new CustomEvent("mychat-terminal-event", { detail })),
                { id: result.id, kind, data },
              )
              .catch(() => {});
          }),
        );
    return result;
  });
  sub = backend.onEvent((event) => {
    void page
      .evaluate(
        (event) => window.dispatchEvent(new CustomEvent("mychat-fixture-event", { detail: event })),
        event,
      )
      .catch(() => {});
  });
  await page.evaluate(mountMyChatFixture, process.cwd());
  const fixture = page.locator("#mychat-mode-fixture");
  await fixture.getByPlaceholder("向 MyChat 提问...").waitFor();
  // 复用 MyChat runtime-terminal 的同一 shell proof，经过实际 hook 与 MyCode PTY。
  const terminalProof = await page.evaluate(async (cwd) => {
    const api = window.__mychatFixture.api;
    let output = "";
    const off = api.terminal.onData((data) => {
      output += data;
    });
    try {
      const result = await api.terminal.restart({ cols: 80, rows: 24, cwd });
      if (!result.ok) throw new Error(result.error);
      await api.terminal.write("printf 'MYCHAT_LOCAL_SHELL_OK\\n'\n");
      for (let i = 0; i < 100 && !output.includes("MYCHAT_LOCAL_SHELL_OK"); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return output.includes("MYCHAT_LOCAL_SHELL_OK");
    } finally {
      off();
    }
  }, root);
  assert.ok(terminalProof);
  await fixture.getByPlaceholder("向 MyChat 提问...").fill("验证完整聊天");
  await fixture.getByRole("button", { name: "发送", exact: true }).click();
  await fixture.getByText("MyChat 已完成流式回复。", { exact: true }).waitFor();
  assert.equal(await fixture.locator(".mychat-surface .assistant-turn").count(), 1);
  await fixture.getByPlaceholder("向 MyChat 提问...").fill("保留中的草稿");
  // 真正的共用头像菜单，而非模拟模式按钮。
  await fixture.getByRole("button", { name: "MyChat", exact: true }).click();
  await page.getByRole("menuitem", { name: "布局模式" }).hover();
  await page.getByRole("menuitemradio", { name: "MyCode", exact: true }).click();
  await fixture.locator("[data-fixture-mycode]").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("mycode-interface-mode")), "mycode");
  await page.evaluate(() => window.__mychatFixture.setMode("mychat"));
  assert.equal(await fixture.getByPlaceholder("向 MyChat 提问...").inputValue(), "保留中的草稿");
  await page.evaluate(() => {
    window.__mychatFixture.setTheme("mycode-light");
    window.__mychatFixture.setFontSize(12);
  });
  assert.equal(
    await fixture.locator(".mychat-surface").evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  assert.equal(
    await fixture
      .locator(".mychat-surface textarea")
      .evaluate((el) => getComputedStyle(el).fontFamily),
    await page
      .locator("[data-fixture-host-font]")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  );
  await fixture.locator('button[aria-label="设置"]').last().click();
  await fixture.locator(".settings-stage").waitFor();
  await fixture.getByRole("button", { name: "Increase font size" }).click();
  await page.waitForFunction(() => localStorage.getItem("mycode-ui-font-size-px") === "13");
  await fixture.locator(".dropdown-select-trigger").filter({ hasText: "Light" }).click();
  await fixture.getByRole("option", { name: "Dark", exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem("mycode-theme") === "mycode-dark");
  await writeFile(
    join(output, "settings-text.txt"),
    await fixture.locator(".settings-stage").innerText(),
  );
  await page.screenshot({ path: join(output, "settings.png") });
  const pages = await fixture.locator(".settings-nav nav button").allTextContents();
  assert.ok(pages.length >= 6);
  for (const name of pages) {
    await fixture.locator(".settings-nav nav button").filter({ hasText: name }).click();
    assert.ok((await fixture.locator(".settings-content").innerText()).trim().length > 0);
  }
  await fixture.getByRole("button", { name: /返回|Back/ }).click();
  await fixture.locator(".picker-trigger").filter({ hasText: "fixture-model" }).waitFor();
  await page.evaluate(() => window.__mychatFixture.setTheme("mycode-dark"));
  await page.screenshot({ path: join(output, "chat-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await fixture.locator(".mychat-surface").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  assert.ok(
    (await fixture.locator(".thread-inner").evaluate((el) => el.getBoundingClientRect().width)) >
      300,
  );
  assert.ok(
    (await fixture.locator(".composer").evaluate((el) => el.getBoundingClientRect().width)) > 300,
  );
  await page.screenshot({ path: join(output, "mobile.png") });
  await page.evaluate(() => window.__mychatFixture.setFontSize(14));
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--ui-font-size") === "14px",
  );
  await verifyWriteIconPolish(page, output);
  const reasoningAndTerminal = await verifyReasoningAndTerminalSummaries(page, output);
  const goalThreadsAndSpacing = await verifyGoalThreadsAndSpacing(page, process.cwd(), output);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        settingsPages: pages,
        terminalProof,
        nativeHostProof,
        reasoningAndTerminal,
        goalThreadsAndSpacing,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  await Promise.all(
    ["failure.png", "failure-text.txt", "error.txt"].map((file) =>
      rm(join(output, file), { force: true }),
    ),
  );
  passed = true;
  console.log(
    "PASS: MyChat stream, preserved draft, mode menu, shared theme/font, complete settings and mobile layout.",
  );
} catch (error) {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: false, error: String(error), errors }, null, 2),
  );
  if (page) {
    await writeFile(join(output, "failure-text.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  }
  await writeFile(join(output, "error.txt"), String(error.stack));
  throw error;
} finally {
  sub?.dispose();
  terminalSubscriptions.forEach((s) => s.dispose());
  terminalOwner.disposeAll();
  await app?.close().catch(() => {});
  await server.close();
  await backend.disposeAllAndWait();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
  await writeFile(join(output, "desktop.log"), desktopOutput.join(""));
  if (passed) await rm(root, { recursive: true, force: true });
  else console.log("Failure profile:", root);
}
