import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
import { createServer } from "vite";
import { selectDesktopRenderer, prepareDesktopUi } from "./mycode-compact-ui-start.mjs";
import { verifySingleFileSummaries } from "./mycode-single-file-summary.mjs";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "mycode-header-ui-"));
const output = resolve(".artifacts/single-file-summary");
await mkdir(output, { recursive: true });
const server = await createServer({
  root: resolve("packages/desktop/src/renderer"),
  configFile: resolve("packages/desktop/vite.config.ts"),
  optimizeDeps: { include: ["@pierre/diffs/worker/worker.js", "react-markdown", "remark-gfm"] },
  server: { port: 5186, strictPort: true },
});
let app, page;
const errors = [];
try {
  await server.listen();
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [resolve("packages/desktop")],
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
  page = await selectDesktopRenderer(app);
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await prepareDesktopUi(page, true);
  await page.evaluate(() => {
    document.getElementById("root").style.display = "none";
  });
  const result = await verifySingleFileSummaries(page, output);
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(join(output, "result.json"), JSON.stringify({ ...result, errors }, null, 2));
  await rm(join(output, "error.txt"), { force: true });
  await rm(join(output, "failure.png"), { force: true });
  process.stdout.write(
    "PASS: Single file summaries: locales, themes, hover/focus, contrast, keyboard, previews and narrow layout.\n",
  );
} catch (error) {
  await writeFile(join(output, "error.txt"), String(error.stack ?? error));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: false, error: String(error), errors }, null, 2),
  );
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
