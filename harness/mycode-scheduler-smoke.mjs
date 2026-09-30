import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import {
  AutomationRepo,
  AutomationService,
  setDataBaseDir,
} from "../packages/services/src/node.ts";

const root = await mkdtemp(join(tmpdir(), "mycode-scheduler-"));
const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const electron = require("electron");
const scheduler = resolve("packages/desktop/out/scheduler/index.js");
const events = [];
let child;
let childExit;
setDataBaseDir(root);
const repo = new AutomationRepo();
const service = new AutomationService(repo);
try {
  const workspace = join(root, "project");
  await mkdir(workspace);
  const scheduled = await service.create({
    title: "Scheduled smoke",
    prompt: "MYCODE_SCHEDULED",
    cronExpr: "* * * * *",
    recurring: false,
    workspacePath: workspace,
    workspaceIdentity: "smoke-scheduled",
  });
  await repo.update(scheduled.automationId, {}, { nextRunAt: Date.now() - 100 });
  const manual = await service.create({
    title: "Manual smoke",
    prompt: "MYCODE_MANUAL",
    cronExpr: "0 0 1 1 *",
    recurring: true,
    workspacePath: workspace,
    workspaceIdentity: "smoke-manual",
  });
  // 正常的手动运行由 Host 直接派发；这里只模拟其超过 10 分钟未结算后的恢复链路。
  const manualRun = await repo.runNow(manual.automationId, { now: Date.now() - 11 * 60_000 });
  const mainPath = join(root, "main.cjs");
  await writeFile(
    mainPath,
    `const {app,utilityProcess}=require('electron');
app.setPath('userData',${JSON.stringify(join(root, "electron-user-data"))});
app.whenReady().then(()=>{
  app.dock?.hide();
  const worker=utilityProcess.fork(${JSON.stringify(scheduler)},[],{env:process.env,serviceName:'mycode-scheduler-smoke'});
  worker.on('message',message=>{
    if(message.type!=='cron-dispatch-request')return;
    process.stdout.write('MYCODE_EVENT '+JSON.stringify(message)+'\\n');
    worker.postMessage({type:'cron-dispatch-result',runId:message.runId,ok:true,taskId:'smoke-task-'+message.automationId,sessionId:'smoke-session-'+message.automationId});
  });
  worker.on('exit',code=>app.exit(code));
  process.stdin.on('data',()=>worker.postMessage({type:'scheduler-dispose'}));
});
setTimeout(()=>app.exit(124),30000).unref();
`,
  );
  child = spawn(electron, [mainPath], {
    env: { ...process.env, MYCODE_DATA_BASE_DIR: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  childExit = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => done(code));
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.startsWith("MYCODE_EVENT ")) events.push(JSON.parse(line.slice(13)));
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 25000;
  let settled = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const current = await service.get(scheduled.automationId);
    const runs = await service.listRuns(manual.automationId);
    if (
      current.lifecycleStatus === "completed" &&
      runs.some((run) => run.runId === manualRun.run.runId && run.dispatchStatus === "dispatched")
    ) {
      settled = true;
      break;
    }
    await delay(100);
  }
  assert.ok(settled, `scheduler did not settle both dispatches: ${stderr}`);
  assert.equal(events.length, 2, "one dispatch for each scheduled and manual automation");
  assert.equal(new Set(events.map((event) => event.runId)).size, 2);
  assert.deepEqual(events.map((event) => event.workspaceIdentity).sort(), [
    "smoke-manual",
    "smoke-scheduled",
  ]);
  assert.ok(events.every((event) => event.workspacePath === workspace));
  child.stdin.write("dispose\n");
  assert.equal(await childExit, 0);
  const evidence = {
    checkedAt: new Date().toISOString(),
    passed: true,
    runtime: "Electron utilityProcess",
    scheduled: "due claim → native IPC → acknowledgement → completed",
    manualRecovery: "stale manual claim → native IPC → acknowledgement → dispatched",
    workspaceIdentityPreserved: true,
    dispatchCount: events.length,
    limitation:
      "Host acknowledgement is supplied by the harness; normal manual dispatch and model execution are not covered.",
  };
  await mkdir(resolve(".artifacts"), { recursive: true });
  await writeFile(resolve(".artifacts/mycode-scheduler.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await childExit;
  }
  repo.close();
  setDataBaseDir(null);
  await rm(root, { recursive: true, force: true });
}
