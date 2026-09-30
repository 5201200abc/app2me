import assert from "node:assert/strict";
import { app, BrowserWindow, nativeImage } from "electron";
import { resolve } from "node:path";
import { createMcpAdapter } from "@mycode/adapters/mcp";
import {
  createDesktopCuaDriver,
  requestDesktopCuaPermissions,
} from "../packages/desktop/src/main/desktopCuaDriver.ts";
import { evaluateWithCdp } from "../packages/desktop/src/main/browserView/browserPlaywrightEvaluate.ts";

// Electron 的 ESM 入口必须先完成导入；顶层 await ready 会让启动和 ready 事件互相等待。
app.whenReady().then(async () => {
  console.log("[cua-driver-e2e] app ready");
  app.setName("MyCode Dev");
  const driver = createDesktopCuaDriver();
  const adapter = createMcpAdapter();
  const results = {};
  let window;
  try {
    window = new BrowserWindow({
      show: true,
      width: 640,
      height: 360,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(
      "data:text/html,<title>MyCode Cua E2E</title><style>body{background:rgb(230,245,240);margin:64px}button{font:24px sans-serif;padding:16px;background:white}</style><button id='toggle' aria-pressed='false'>Pause</button><script>toggle.onclick=()=>toggle.setAttribute('aria-pressed',toggle.getAttribute('aria-pressed')==='false')</script>",
    );
    const contents = window.webContents;
    contents.debugger.attach("1.3");
    const pending = new Set();
    const view = {
      webContents: contents,
      cdp: {
        send(method, params) {
          const request = contents.debugger.sendCommand(method, params);
          pending.add(request);
          request.finally(() => pending.delete(request)).catch(() => {});
          return request;
        },
      },
    };
    const start = Date.now();
    await assert.rejects(
      evaluateWithCdp(view, "new Promise(() => {})", 3000),
      /timed out after 3000ms/,
    );
    results.browserTimeoutMs = Date.now() - start;
    assert.equal(await evaluateWithCdp(view, "42", 3000), 42);
    assert.equal(await evaluateWithCdp(view, "Promise.resolve(42)", 3000), 42);
    assert.equal(
      await evaluateWithCdp(
        view,
        "(() => { document.querySelector('#toggle').click(); return document.querySelector('#toggle').getAttribute('aria-pressed'); })()",
        3000,
      ),
      "true",
    );
    assert.equal(pending.size, 0);
    results.browser =
      "passed: timeout, subsequent sync/async calls, DOM click, zero pending CDP commands";
    contents.debugger.detach();

    if (process.argv.includes("--request-permissions")) await requestDesktopCuaPermissions();
    const status = await driver.execute("status");
    results.permissions = status;
    if (!status.accessibility || !status.screenRecording) {
      results.cua = "blocked: MyCode system permissions are missing";
      process.exitCode = 2;
    } else {
      const [connection, concurrent] = await Promise.all([
        driver.execute("connect"),
        driver.execute("connect"),
      ]);
      assert.equal(connection.kind, "connection");
      assert.equal(concurrent.kind, "connection");
      assert.equal(concurrent.generation, connection.generation);
      results.concurrentStart = "passed: shared generation";
      const transportStatus = await adapter.connectServer("cua_driver", {
        type: "stdio",
        command: connection.command,
        args: connection.args,
        env: connection.env,
        protocolVersion: "legacy",
        timeoutMs: 10_000,
      });
      assert.equal(transportStatus.status, "connected", transportStatus.error);
      const tools = await adapter.listTools();
      assert.ok(tools.some((tool) => tool.toolName === "check_permissions"));
      assert.ok(tools.some((tool) => tool.toolName === "get_accessibility_tree"));
      const permissions = await adapter.callTool({
        serverName: "cua_driver",
        toolName: "check_permissions",
        arguments: {},
      });
      assert.notEqual(permissions.isError, true, "native permission tool failed");
      const observation = await adapter.callTool({
        serverName: "cua_driver",
        toolName: "get_accessibility_tree",
        arguments: {},
      });
      assert.notEqual(observation.isError, true, "native desktop observation failed");
      const windows = await adapter.callTool({
        serverName: "cua_driver",
        toolName: "list_windows",
        arguments: { pid: process.pid },
      });
      assert.notEqual(windows.isError, true, "native window discovery failed");
      const ownWindow = windows.structuredContent?.windows?.find(
        (item) => item.title === "MyCode Cua E2E",
      );
      assert.ok(ownWindow, "native driver did not discover the isolated test window");
      const screenshotPath = resolve(
        import.meta.dirname,
        "../../../../.mycode-runtime/cua-driver-fixture.png",
      );
      const state = await adapter.callTool({
        serverName: "cua_driver",
        toolName: "get_window_state",
        arguments: {
          pid: process.pid,
          window_id: ownWindow.window_id,
          screenshot_out_file: screenshotPath,
        },
      });
      assert.notEqual(state.isError, true, "native AX and screenshot observation failed");
      assert.ok(state.structuredContent?.elements?.length > 0, "native AX tree is empty");
      const screenshot = nativeImage.createFromPath(screenshotPath);
      assert.equal(screenshot.isEmpty(), false);
      assert.ok(screenshot.getSize().width > 100 && screenshot.getSize().height > 100);
      const bitmap = screenshot.toBitmap();
      const colors = new Set();
      for (let i = 0; i < bitmap.length; i += 400) colors.add(bitmap.readUInt32LE(i));
      assert.ok(colors.size > 3, "native screenshot is blank");
      results.nativeCapture = {
        elements: state.structuredContent.elements.length,
        screenshotPath,
        size: screenshot.getSize(),
        colors: colors.size,
      };
      results.cua =
        "passed: daemon startup, actual MyCode MCP adapter handshake, permissions and native desktop observation";
      results.toolCount = tools.length;
      await adapter.close();
      await driver.execute("restart");
      const renewed = await driver.execute("connect");
      assert.notEqual(renewed.generation, connection.generation);
      results.restart = "passed: generation changed";
    }
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await adapter.close();
    await driver.dispose();
    window?.destroy();
    results.exitCode = process.exitCode ?? 0;
    console.log(JSON.stringify(results));
    app.exit(process.exitCode ?? 0);
  }
});
