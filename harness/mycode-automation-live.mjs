import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright-core";
import {
  AutomationRepo,
  AutomationService,
  setDataBaseDir,
} from "../packages/services/src/node.ts";
import { prepareDevElectronAppBundle } from "../packages/desktop/scripts/devElectronAppBundle.mjs";
import { verifyComposerLayout } from "./mycode-composer-layout.mjs";

const root = await mkdtemp(join(tmpdir(), "mycode-automation-live-"));
const output = resolve(".artifacts/mycode-followup");
await mkdir(output, { recursive: true });
const storage = join(root, ".mycode");
const config = join(storage, "v2");
const sessionDatabase = join(storage, "cli", "live-validation.sqlite");
const workspace = join(root, "project");
await mkdir(config, { recursive: true });
await mkdir(workspace);
await copyFile(
  join(homedir(), ".mycode/v2/provider_config.json"),
  join(config, "provider_config.json"),
);

setDataBaseDir(root);
const repo = new AutomationRepo();
const service = new AutomationService(repo);
const selection = {
  providerId: "deepseek",
  modelId: "deepseek-flash",
  options: { reasoningLevel: "disabled" },
};
const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const bundle = await prepareDevElectronAppBundle({
  electronAppPath: resolve(dirname(require("electron")), "../.."),
  electronVersion: require("electron/package.json").version,
  runtimeRoot: resolve(".mycode-runtime/desktop-dev"),
  arch: process.arch,
});
const result = {
  checkedAt: new Date().toISOString(),
  passed: false,
  runs: [],
  requests: [],
  pageErrors: [],
};
let app;
let page;

async function waitForRun(automationId, trigger) {
  let lastState;
  for (const deadline = Date.now() + 180_000; Date.now() < deadline; ) {
    const run = (await repo.listRuns(automationId)).find((run) => run.trigger === trigger);
    const state = run ? `${run.dispatchStatus}/${run.outcome || "pending"}` : "unclaimed";
    if (state !== lastState) console.log(JSON.stringify({ trigger, state }));
    lastState = state;
    if (run?.outcome === "succeeded") return run;
    if (
      run &&
      (run.outcome === "failed" || run.outcome === "stopped" || run.dispatchStatus === "failed")
    )
      throw new Error(JSON.stringify(run));
    await delay(1000);
  }
  throw new Error(`${trigger} automation did not complete: ${lastState}`);
}

function readAssistantText(sessionId) {
  const db = new DatabaseSync(sessionDatabase, { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT p.data FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? AND json_extract(m.data, '$.role') = 'assistant' ORDER BY p.time_created, p.id",
      )
      .all(sessionId)
      .map((row) => JSON.parse(row.data))
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  } finally {
    db.close();
  }
}

async function readModelEvidence(runs) {
  const sessionIds = new Set(runs.map((run) => run.sessionId));
  const evidence = [];
  for (const path of await readdir(storage, { recursive: true })) {
    if (!/model-io-.*\.jsonl$/.test(path)) continue;
    for (const line of (await readFile(join(storage, path), "utf8")).trim().split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (!sessionIds.has(record.sessionId)) continue;
      const body =
        typeof record.request?.body === "string"
          ? JSON.parse(record.request.body)
          : record.request?.body;
      // 运行时在 option-map fetch 处捕获真实请求体。只导出验收字段，不复制请求头和上下文。
      evidence.push({
        sessionId: record.sessionId,
        model: body?.model,
        thinking: body?.thinking,
        providerId: record.model?.providerId,
        responseModel: record.response?.modelId,
        finishReason: record.response?.finishReason,
        reasoningText: record.response?.reasoningText,
        error: record.error,
        bodySource: body?.bodySource,
        source: path,
      });
    }
  }
  return evidence;
}

try {
  const scheduled = await service.create({
    title: "DeepSeek scheduled verification",
    prompt: "仅回复 MYCODE_AUTOMATION_SCHEDULED_7F26。不要调用工具，不要添加解释。",
    cronExpr: "* * * * *",
    recurring: false,
    workspacePath: workspace,
    modelSelection: selection,
  });
  await repo.update(scheduled.automationId, {}, { nextRunAt: Date.now() - 100 });
  const manual = await service.create({
    title: "DeepSeek manual verification",
    prompt: "仅回复 MYCODE_AUTOMATION_MANUAL_7F26。不要调用工具，不要添加解释。",
    cronExpr: "0 0 1 1 *",
    recurring: true,
    workspacePath: workspace,
    modelSelection: selection,
  });
  app = await _electron.launch({
    executablePath: bundle.executablePath,
    args: [resolve("packages/desktop"), `--user-data-dir=${join(root, "electron")}`],
    env: {
      ...process.env,
      MYCODE_DATA_BASE_DIR: root,
      MYCODE_STORAGE_DIR: storage,
      MYCODE_SESSION_DB_PATH: sessionDatabase,
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  await page.waitForLoadState();
  const start = page.getByRole("button", { name: /^(开始使用|Get started|Start using)$/ });
  await page
    .locator('[data-testid="composer-model-controls"]')
    .or(start)
    .waitFor({ timeout: 30_000 });
  if (await start.isVisible()) await start.click();
  await page.locator('[data-testid="composer-model-controls"]').waitFor({ timeout: 30_000 });
  result.composerLayouts = await verifyComposerLayout(page, output);
  const scheduledRun = await waitForRun(scheduled.automationId, "schedule");
  const scheduledText = readAssistantText(scheduledRun.sessionId);
  assert.match(scheduledText, /MYCODE_AUTOMATION_SCHEDULED_7F26/);
  result.runs.push({ ...scheduledRun, assistantText: scheduledText });
  await page
    .getByText(/^(自动化|Automations)$/)
    .first()
    .click();
  await page.getByText(manual.title, { exact: true }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /^(立即运行|Run now)$/ }).click();
  const manualRun = await waitForRun(manual.automationId, "manual");
  const manualText = readAssistantText(manualRun.sessionId);
  assert.match(manualText, /MYCODE_AUTOMATION_MANUAL_7F26/);
  result.runs.push({ ...manualRun, assistantText: manualText });
  result.requests = await readModelEvidence(result.runs);
  assert.ok(result.requests.length >= 2, "both automations must make real requests");
  assert.ok(
    result.requests.every(
      (request) =>
        request.model === "deepseek-flash" &&
        request.thinking?.type === "disabled" &&
        !request.error &&
        !request.reasoningText &&
        request.bodySource !== "ai_sdk_options",
    ),
  );
  assert.ok(
    result.runs.every((run) =>
      result.requests.some(
        (request) => request.sessionId === run.sessionId && request.finishReason === "stop",
      ),
    ),
  );
  assert.ok(
    result.runs.every((run) => run.dispatchStatus === "dispatched" && run.outcome === "succeeded"),
  );
  assert.deepEqual(result.pageErrors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  result.databaseRuns = await Promise.all(
    (await repo.list()).map(async (automation) => ({
      title: automation.title,
      runs: await repo.listRuns(automation.automationId),
    })),
  );
  if (page && !page.isClosed()) {
    result.visibleText = await page.locator("body").innerText();
    await page.screenshot({ path: join(output, "automation-live.png") });
  }
  throw error;
} finally {
  await writeFile(join(output, "automation-live.json"), JSON.stringify(result, null, 2));
  await app?.close();
  repo.close();
  await rm(root, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      passed: result.passed,
      runs: result.runs.length,
      requests: result.requests.length,
      failure: result.failure,
    }),
  );
}
