import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { NodeProviderRegistryRuntime } from "../packages/provider-node/src/index.ts";
import { createMyCodeApp } from "../apps/mycode-cli/packages/bootstrap/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "mycode-deepseek-live-"));
const output = resolve(".artifacts/mycode-followup");
const workspace = join(root, "project");
await mkdir(workspace);
await mkdir(output, { recursive: true });
const personal = join(root, "provider_config.json");
await copyFile(join(homedir(), ".mycode/v2/provider_config.json"), personal);
const registry = new NodeProviderRegistryRuntime({
  mycodeBuiltinFilePath: resolve("config/provider/mycode-builtin.json"),
  personalFilePath: personal,
  watch: false,
  personalPollingIntervalMs: false,
});
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname === "api.deepseek.com" && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    requests.push({
      model: body.model,
      thinking: body.thinking,
      toolCount: body.tools?.length ?? 0,
      automaticExtraction: body.messages?.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("You are now acting as the memory extraction subagent"),
      ),
    });
  }
  return originalFetch(input, init);
};
const results = [];
let app;
const env = {
  ...process.env,
  MYCODE_STORAGE_DIR: join(root, "storage"),
  MYCODE_DATA_BASE_DIR: root,
  MYCODE_TELEMETRY_ENABLED: "false",
};
const selection = {
  providerId: "deepseek",
  modelId: "deepseek-flash",
  options: { reasoningLevel: "disabled" },
};
async function memoryFiles(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, item.name);
    if (item.isDirectory()) files.push(...(await memoryFiles(path)));
    else if (item.name.endsWith(".md") && path.includes("/memory/")) {
      files.push({ path: path.slice(root.length), content: await readFile(path, "utf8") });
    }
  }
  return files;
}
try {
  await registry.start();
  app = await createMyCodeApp({
    env,
    skipUserConfig: true,
    providerRegistry: registry.registryService,
    configuredDefaultModelSelection: selection,
    runtimeConfig: {
      workingDirectory: workspace,
      modelSelection: selection,
      maxTurns: 8,
      memory: { enabled: true, extractionEnabled: true, use: true },
      titleGeneration: { enabled: false },
    },
    permissionBroker: {
      async requestPermission(request) {
        return {
          decision: request.toolName === "Agent" ? "allow" : "deny",
          resolvedAt: new Date(),
          reason: "Isolated live model test allows only the child-agent tool.",
        };
      },
    },
  });
  assert.equal(app.getThoughtLevel(), "disabled");
  const main = await app.submitPrompt(
    "Project convention for future sessions: release archives use the prefix MYCODE_MEMORY_7F26 and release notes are always bilingual Chinese/English. In this turn do not write files, do not call tools, and reply exactly MYCODE_PARENT_OK.",
    { abortSignal: AbortSignal.timeout(90_000) },
  );
  assert.equal(main.response.trim(), "MYCODE_PARENT_OK");
  assert.ok(
    !main.events.some((event) => event.type === "tool_call_scheduled"),
    "the main turn must not write the memory directly",
  );
  results.push({
    capability: "runtime",
    passed: true,
    response: main.response,
    sessionId: app.sessionId,
  });
  await app.runtime.drainMemoryExtractions(90_000);
  const memories = await memoryFiles(root);
  assert.ok(
    memories.some((file) => file.content.includes("MYCODE_MEMORY_7F26")),
    "automatic extraction must persist the project convention",
  );
  assert.ok(
    requests.some((request) => request.automaticExtraction),
    "a separate extraction request must reach the real model",
  );
  results.push({ capability: "automatic-memory", passed: true, files: memories });
  const child = await app.submitPrompt(
    "Use the Agent tool exactly once to launch a general-purpose subagent. Its entire task is to reply exactly MYCODE_REAL_CHILD_7F26, without tools or file operations. Wait for its result, then reply with that exact result. You must actually launch the subagent, not answer in its place.",
    {
      abortSignal: AbortSignal.timeout(120_000),
      modelExecution: { selectionScope: "execution", memoryExtraction: "skip" },
    },
  );
  const children = await app.readSubagents();
  results.push({
    capability: "real-subagent",
    response: child.response,
    children,
    eventTypes: child.events.map((event) => event.type),
  });
  assert.ok(child.response.includes("MYCODE_REAL_CHILD_7F26"));
  assert.equal(children.childSessionIds.length, 1);
  assert.notEqual(children.childSessionIds[0], app.sessionId);
  assert.equal(children.ended.items[0].status, "success");
  assert.equal(children.ended.items[0].summary.trim(), "MYCODE_REAL_CHILD_7F26");
  const transcript = await app.readSubagentTranscript(children.childSessionIds[0]);
  assert.ok(JSON.stringify(transcript).includes("MYCODE_REAL_CHILD_7F26"));
  results.at(-1).childTranscript = transcript;
  results.at(-1).passed = true;
  assert.ok(requests.length >= 3);
  assert.ok(
    requests.every(
      (request) => request.model === "deepseek-flash" && request.thinking?.type === "disabled",
    ),
  );
} catch (error) {
  results.push({ passed: false, error: error.stack });
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "deepseek-runtime.json"),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), nodeVersion: process.version, requests, results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ requests, results }));
  await app?.close?.();
  registry.dispose();
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}
