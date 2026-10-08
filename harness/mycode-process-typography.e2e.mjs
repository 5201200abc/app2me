import { verifyCapabilitySettings } from "./mycode-capability-settings.mjs";
import { verifyResourceControls } from "./mycode-resource-layout.mjs";
import { verifyThemePolish } from "./mycode-theme-polish.mjs";
import { verifyInterfaceTypography } from "./mycode-interface-typography.mjs";
import { verifyMyChatControlsPolish } from "./mychat-controls-polish.mjs";
import { verifySummaryPanelAnchor } from "./mycode-summary-panel-anchor.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
import { createServer } from "vite";

import { verifyFooterBarAlignment } from "./mycode-footer-bar-alignment.mjs";
import { verifyUsageReadingPolish } from "./mycode-usage-reading-polish.mjs";
import { verifyCollapsedToolbar } from "./mycode-collapsed-toolbar.mjs";
import { verifyOperationIconsAndSidebarHeader } from "./mycode-operation-icons-and-sidebar-header.mjs";
import { verifyProcessTypography } from "./mycode-process-typography.mjs";
import { verifyInventoryChangeRow } from "./mycode-inventory-change-row.mjs";
import { verifyReferenceToolTimeline } from "./mycode-reference-tool-timeline.mjs";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "mycode-header-ui-"));
const capabilitySettings = process.argv.includes("--capability-settings");
const resourceControls = process.argv.includes("--resource-controls");
const themePolish = process.argv.includes("--theme-polish");
const interfaceTypography = process.argv.includes("--interface-typography");
const chatControls = process.argv.includes("--chat-controls");
const summaryAnchor = process.argv.includes("--summary-anchor");
const footerBar = process.argv.includes("--footer-bar");
const usagePolish = process.argv.includes("--usage-polish");
const collapsedToolbar = process.argv.includes("--collapsed-toolbar");
const sidebarIcons = process.argv.includes("--sidebar-icons");
const inventoryOnly = process.argv.includes("--inventory-changes");
const referenceTimeline = process.argv.includes("--reference-timeline");
const output = resolve(
  resourceControls
    ? ".artifacts/resource-controls"
    : capabilitySettings
      ? ".artifacts/capability-settings"
      : themePolish
        ? `.artifacts/theme-polish/${process.argv.includes("--before") ? "before" : "after"}`
        : interfaceTypography
          ? ".artifacts/interface-typography"
          : summaryAnchor
            ? ".artifacts/summary-panel-anchor"
            : chatControls
              ? ".artifacts/mychat-controls-polish"
              : footerBar
                ? ".artifacts/footer-bar-alignment"
                : usagePolish
                  ? ".artifacts/usage-reading-polish"
                  : collapsedToolbar
                    ? ".artifacts/collapsed-toolbar"
                    : sidebarIcons
                      ? ".artifacts/operation-icons-sidebar-header"
                      : referenceTimeline
                        ? ".artifacts/reference-tool-timeline"
                        : inventoryOnly
                          ? ".artifacts/inventory-change-row"
                          : ".artifacts/process-typography",
);
await mkdir(output, { recursive: true });
const server = await createServer({
  plugins: [
    {
      name: "process-fixture-entry",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__process-fixture") return next();
          const html = await server.transformIndexHtml(
            "/__process-fixture",
            `<!doctype html><html><head></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import '@mycode/ui/styles.css';
window.__fixtureBootstrap = {React, createRoot};
</script></body></html>`,
          );
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      },
    },
  ],
  root: resolve("packages/desktop/src/renderer"),
  configFile: resolve("packages/desktop/vite.config.ts"),
  ...(usagePolish ? { cacheDir: join(root, "vite-cache") } : {}),
  optimizeDeps: { include: ["@pierre/diffs/worker/worker.js", "react-markdown", "remark-gfm"] },
  server: { port: 5186, strictPort: true },
});
const entry = join(root, "main.cjs");
await writeFile(
  entry,
  `const {app, BrowserWindow} = require('electron');
app.setPath('userData', ${JSON.stringify(join(root, "electron"))});
app.whenReady().then(() => new BrowserWindow({width:1100,height:900,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}}).loadURL('http://localhost:5186/__process-fixture'));
app.on('window-all-closed', () => app.quit());`,
);

let app, page;
const errors = [];
try {
  await server.listen();
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [entry],
    env: {
      ...process.env,
      MYCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      MYCODE_DESKTOP_APPLICATION_NAME: `MyCode Header E2E ${process.pid}`,
      MYCODE_DESKTOP_HOME_DIR: root,
      MYCODE_DESKTOP_USER_DATA_DIR: join(root, "electron"),
      MYCODE_DESKTOP_SESSION_DATA_DIR: join(root, "electron-session"),
      MYCODE_DATA_BASE_DIR: root,
      MYCODE_STORAGE_DIR: join(root, ".mycode"),
      MYCODE_SESSION_DB_PATH: join(root, "cli.sqlite"),
      ELECTRON_RENDERER_URL: "http://localhost:5186",
    },
  });
  page = await app.firstWindow();
  await page.bringToFront();
  await page.waitForURL("http://localhost:5186/__process-fixture");
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__fixtureBootstrap);
  await page.evaluate(() => {
    document.getElementById("root").style.display = "none";
  });
  const result = await (
    resourceControls
      ? verifyResourceControls
      : capabilitySettings
        ? verifyCapabilitySettings
        : themePolish
          ? verifyThemePolish
          : interfaceTypography
            ? verifyInterfaceTypography
            : summaryAnchor
              ? verifySummaryPanelAnchor
              : chatControls
                ? verifyMyChatControlsPolish
                : footerBar
                  ? verifyFooterBarAlignment
                  : usagePolish
                    ? verifyUsageReadingPolish
                    : collapsedToolbar
                      ? verifyCollapsedToolbar
                      : sidebarIcons
                        ? verifyOperationIconsAndSidebarHeader
                        : referenceTimeline
                          ? verifyReferenceToolTimeline
                          : inventoryOnly
                            ? verifyInventoryChangeRow
                            : verifyProcessTypography
  )(page, output, app);
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(join(output, "result.json"), JSON.stringify({ ...result, errors }, null, 2));
  await rm(join(output, "error.txt"), { force: true });
  await rm(join(output, "failure.png"), { force: true });
  await rm(join(output, "failure-layout.json"), { force: true });
  process.stdout.write(
    resourceControls
      ? "PASS: Resource controls alignment.\n"
      : capabilitySettings
        ? "PASS: Capability settings and permission-gated toggle.\n"
        : themePolish
          ? "PASS: Theme polish and typography.\n"
          : interfaceTypography
            ? "PASS: Interface typography at 1x and 2x.\n"
            : summaryAnchor
              ? "PASS: Summary panel toolbar anchor.\n"
              : chatControls
                ? "PASS: MyChat mode and controls polish.\n"
                : footerBar
                  ? "PASS: Footer, sources and composer bar alignment.\n"
                  : usagePolish
                    ? "PASS: Usage rendering and reading polish.\n"
                    : collapsedToolbar
                      ? "PASS: Collapsed toolbar: icon sizes, strokes, centers, themes, platforms and callbacks.\n"
                      : sidebarIcons
                        ? "PASS: Operation icon priority, book icon, sidebar header order, search alignment and preserved actions.\n"
                        : referenceTimeline
                          ? "PASS: Reference tool timeline: icons, type, spacing, cards, wrap, copy, scroll, locales and preserved interactions.\n"
                          : inventoryOnly
                            ? "PASS: Inventory changes: reference surface, icons, typography, number formatting, contrast, locales and preserved click.\n"
                            : "PASS: Process typography and inventory changes: alignment, spacing, type hierarchy, icons, locales, themes and preserved interactions.\n",
  );
} catch (error) {
  await writeFile(join(output, "error.txt"), String(error.stack ?? error));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: false, error: String(error), errors }, null, 2),
  );
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  if (page)
    await writeFile(
      join(output, "failure-layout.json"),
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll("[data-type-fixture] [data-process-row]")].map((el) => {
            const b = el.getBoundingClientRect(),
              s = getComputedStyle(el);
            const hit = document.elementFromPoint(b.right - 2, b.bottom - 1);
            return {
              text: el.textContent,
              rect: { x: b.x, y: b.y, width: b.width, height: b.height },
              padding: s.padding,
              border: s.borderWidth,
              pointer: s.pointerEvents,
              hit: hit?.outerHTML.slice(0, 800),
            };
          }),
        ),
        null,
        2,
      ),
    ).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
