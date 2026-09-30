import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import {
  AutomationRepo,
  AutomationService,
  createCommandsService,
  createMemoryService,
  createSkillsService,
  createSubagentsService,
  setDataBaseDir,
} from "../packages/services/src/node.ts";
import {
  createConfiguredHookRunner,
  createExploreSubagentPort,
  resolveProjectMemoryRoot,
} from "../apps/mycode-cli/packages/core/dist/index.js";
import {
  createNodeCustomCommandAdapter,
  createNodeSkillAdapter,
  createNodeExecutionAdapter,
  createMcpAdapter,
} from "../apps/mycode-cli/packages/adapters/dist/index.js";
import { createComputerUseRuntime } from "../packages/mycode-cua/index.js";

const root = await mkdtemp(join(tmpdir(), "mycode-capabilities-"));
const workspace = join(root, "project");
const output = resolve(".artifacts/mycode-capabilities.json");
await mkdir(workspace, { recursive: true });
await mkdir(dirname(output), { recursive: true });
setDataBaseDir(root);
const results = [];
async function check(capability, body) {
  try {
    results.push({ capability, ...(await body()), passed: true });
  } catch (error) {
    results.push({ capability, passed: false, error: error.stack });
    process.exitCode = 1;
  }
}
try {
  await check("automation", async () => {
    const repo = new AutomationRepo(join(root, "automation.sqlite"));
    const service = new AutomationService(repo);
    try {
      await assert.rejects(
        service.create({
          title: "invalid",
          prompt: "test",
          cronExpr: "invalid",
          workspacePath: workspace,
          recurring: true,
        }),
      );
      const item = await service.create({
        title: "Smoke",
        prompt: "Reply OK",
        cronExpr: "* * * * *",
        workspacePath: workspace,
        recurring: false,
      });
      const dueAt = item.nextRunAt + 1;
      assert.equal((await repo.claimDue(dueAt)).length, 1);
      assert.equal((await repo.claimDue(dueAt)).length, 0, "no duplicate admission");
      await repo.markDispatched(item.automationId, { dispatchedAt: dueAt, nextRunAt: null });
      assert.equal((await service.get(item.automationId)).lifecycleStatus, "completed");
      assert.equal((await repo.claimDue(dueAt + 60_000)).length, 0);
      await service.delete(item.automationId);
      assert.equal((await service.list()).length, 0);
      return {
        level: "service-and-database",
        evidence:
          "create, invalid cron rejection, due admission, deduplication, completion, delete",
        limitation: "This check does not execute the Electron scheduler or a model turn.",
      };
    } finally {
      repo.close();
    }
  });
  await check("computer-use", async () => {
    const runtime = createComputerUseRuntime({});
    const result = await runtime.execute({ action: "screenshot" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not available/);
    await runtime.dispose();
    return { usable: false, level: "actual-runtime-call", evidence: result.content[0].text };
  });
  await check("memory", async () => {
    const memoryRoot = resolveProjectMemoryRoot({
      cliStorageRoot: join(root, ".mycode", "cli"),
      workspacePath: workspace,
    });
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(
      join(memoryRoot, "MEMORY.md"),
      "# Memory\n\nUse the MYCODE_SMOKE convention.\n",
    );
    const service = createMemoryService();
    const projects = await service.listProjectMemories();
    assert.equal(projects.length, 1);
    const file = await service.readProjectMemoryFile({
      workspaceId: basename(dirname(memoryRoot)),
      fileName: "MEMORY.md",
    });
    assert.match(file.content, /MYCODE_SMOKE/);
    await assert.rejects(
      service.readProjectMemoryFile({ workspaceId: "..", fileName: "MEMORY.md" }),
    );
    return {
      level: "storage-and-reader",
      evidence:
        "CLI memory path is discovered by the settings service; Markdown read and path traversal rejection",
      limitation: "Automatic model-driven memory extraction is a separate check.",
    };
  });
  await check("skills", async () => {
    const skillRoot = join(workspace, ".mycode", "skills");
    const skillDir = join(skillRoot, "smoke");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: smoke\ndescription: Validate the local mycode skill loader.\n---\n\nReturn MYCODE_SKILL_OK.\n",
    );
    const service = createSkillsService();
    assert.ok(
      (await service.list({ workspacePath: workspace })).skills.some(
        (skill) => skill.name === "smoke",
      ),
    );
    const adapter = createNodeSkillAdapter();
    const roots = [{ path: skillRoot, scope: "workspace", source: "mycode", priority: 0 }];
    const content = await adapter.loadSkill({ name: "smoke", roots, workingDirectory: workspace });
    assert.match(content.content, /MYCODE_SKILL_OK/);
    await assert.rejects(
      adapter.loadSkill({ name: "missing", roots, workingDirectory: workspace }),
    );
    return {
      level: "service-and-runtime-adapter",
      evidence:
        "settings discovery and CLI loading use the same SKILL.md; missing skill is rejected",
    };
  });
  await check("commands", async () => {
    const service = createCommandsService();
    const created = await service.writeCommandFile({
      config: {
        name: "smoke",
        prompt: "Return MYCODE_COMMAND_OK.",
        description: "Local smoke command",
      },
      storageLevel: "project",
      workspacePath: workspace,
    });
    assert.ok(
      (await service.list({ workspacePath: workspace })).commands.some(
        (command) => command.name === "/smoke",
      ),
    );
    const adapter = createNodeCustomCommandAdapter();
    const roots = [
      {
        path: dirname(created.command.filePath),
        scope: "workspace",
        source: "mycode",
        priority: 0,
      },
    ];
    const content = await adapter.loadCommand({
      name: "smoke",
      roots,
      workingDirectory: workspace,
    });
    assert.match(content.content, /MYCODE_COMMAND_OK/);
    await service.deleteCommandFile({
      commandId: created.command.id,
      filePath: created.command.filePath,
    });
    await assert.rejects(
      adapter.loadCommand({ name: "smoke", roots, workingDirectory: workspace }),
    );
    return {
      level: "service-and-runtime-adapter",
      evidence: "create, discover, load prompt, delete, reject deleted command",
    };
  });
  await check("hooks", async () => {
    const executionPort = createNodeExecutionAdapter();
    const events = [];
    const executionResults = [];
    const execute = executionPort.run.bind(executionPort);
    executionPort.run = async (...args) => {
      const result = await execute(...args);
      executionResults.push(result);
      return result;
    };
    const runner = createConfiguredHookRunner({
      config: {
        enabled: true,
        timeoutMs: 5000,
        maxOutputBytes: 32768,
        events: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "process",
                  command: process.execPath,
                  args: [
                    "-e",
                    "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'MYCODE_HOOK_OK'}}))",
                  ],
                },
              ],
            },
          ],
        },
      },
      executionPort,
      getWorkingDirectory: () => workspace,
      emitEvent: async (event) => {
        events.push(event);
      },
    });
    assert.ok(runner);
    const result = await runner.run({
      hookEventName: "UserPromptSubmit",
      prompt: "test",
      cwd: workspace,
      mode: "build",
      sessionId: "smoke-session",
      traceId: "smoke-trace",
      timestamp: new Date().toISOString(),
    });
    assert.ok(
      result.additionalContexts.some((item) => item.includes("MYCODE_HOOK_OK")),
      JSON.stringify({ result, events, executionResults }),
    );
    return {
      level: "real-child-process",
      evidence:
        "configured UserPromptSubmit hook executes a Node process and its JSON adds model context",
    };
  });
  await check("subagents", async () => {
    const service = createSubagentsService({ homeDir: root, isDesktopRuntime: true });
    const created = await service.createAgent({
      provider: "glm",
      scope: "workspace",
      workspacePath: workspace,
      config: {
        name: "smoke",
        description: "Local verification",
        systemPrompt: "Return MYCODE_CHILD_OK.",
      },
    });
    assert.ok(
      (await service.list({ provider: "glm", workspacePath: workspace })).agents.some(
        (agent) => agent.name === "smoke",
      ),
    );
    let childSession;
    const port = createExploreSubagentPort({
      outputRootDir: join(root, "outputs"),
      emitParentEvent: async () => {},
      runExploreAgent: async (request) => {
        childSession = request.sessionId;
        await request.onSessionReady?.();
        return { response: "MYCODE_CHILD_OK", traceId: request.traceContext.traceId, events: [] };
      },
    });
    const result = await port.launch({
      sessionId: "parent-session",
      parentToolCallId: "parent-tool",
      agentType: "general-purpose",
      description: "Smoke",
      prompt: "Reply OK",
      workingDirectory: workspace,
      workspaceRoot: workspace,
      trace: { traceId: "smoke-trace", sessionId: "parent-session" },
    });
    assert.notEqual(childSession, "parent-session");
    assert.match(JSON.stringify(result), /MYCODE_CHILD_OK/);
    await service.deleteAgent({ agentId: created.agent.id, filePath: created.agent.path });
    return {
      level: "orchestration-with-model-stub",
      evidence: "profile create/discover/delete, distinct child session, parent result delivery",
      limitation:
        "The child model is a deterministic stub; this is not proof that a configured external model can execute a child turn.",
    };
  });
  await check("mcp", async () => {
    const serverPath = join(root, "echo-mcp.mjs");
    await writeFile(
      serverPath,
      `import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin});
input.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;
if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'mycode-smoke',version:'1.0.0'}};
else if(m.method==='tools/list')result={tools:[{name:'echo',description:'Echo smoke text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
else if(m.method==='tools/call')result={content:[{type:'text',text:m.params.arguments.text}]};
else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});\n`,
    );
    const adapter = createMcpAdapter({ workingDirectory: workspace });
    try {
      const status = await adapter.connectServer("smoke", {
        type: "stdio",
        command: process.execPath,
        args: [serverPath],
        enabled: true,
        timeoutMs: 5000,
      });
      assert.equal(status.status, "connected");
      assert.ok(
        (await adapter.listTools()).some(
          (tool) => tool.name === "echo" || tool.toolName === "echo",
        ),
      );
      const result = await adapter.callTool({
        serverName: "smoke",
        toolName: "echo",
        arguments: { text: "MYCODE_MCP_OK" },
      });
      assert.match(JSON.stringify(result), /MYCODE_MCP_OK/);
      return {
        level: "real-stdio-protocol",
        evidence:
          "initialize, tools/list, tools/call and exact echo reply from a real child server",
      };
    } finally {
      await adapter.disconnectServer("smoke");
    }
  });
} finally {
  setDataBaseDir(null);
  await writeFile(
    output,
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  );
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(results, null, 2));
