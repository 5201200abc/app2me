import assert from "node:assert/strict";
import { test } from "node:test";
import { ProxyChannel } from "@mycode/rpc";
import type { IMyChatService } from "../src/mychat/myChat.js";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  parseMyChatRequest,
  type Settings,
  type Conversation,
  type ChatMessage,
  type MyChatEvent,
} from "@mycode/shared/mychat";
import { createMyChatService } from "../src/mychat/runtime/runtime.js";
import { memoryBlock } from "../src/mychat/runtime/memory.js";

const waitFor = async (check: () => boolean) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 8000) throw new Error("Timed out waiting for stream event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("MyChat preserves CRUD, streaming, cancellation, regeneration, scoped memory and attachments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mychat-runtime-"));
  const received: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/health") return void response.end("{}");
    if (request.url === "/v1/models")
      return void response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
    if (request.url === "/props")
      return void response.end(JSON.stringify({ model_alias: "fixture-model" }));
    if (request.url === "/v1/chat/completions") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      received.push(body);
      if (!body.stream)
        return void response.end(
          JSON.stringify({ choices: [{ message: { content: "偏好记忆" } }] }),
        );
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"reasoning_content":"思考过程"}}]}\n\n');
      const timer = setTimeout(() => {
        response.write('data: {"choices":[{"delta":{"content":"已记住：喜欢中文回复"}}]}\n\n');
        response.end("data: [DONE]\n\n");
      }, 150);
      response.once("close", () => clearTimeout(timer));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const service = createMyChatService(directory);
  const events: MyChatEvent[] = [];
  const subscription = service.onEvent((event) => events.push(event));
  try {
    const settings = (await service.call({ command: "settings:get", args: [] })) as Settings;
    await mkdir(join(directory, "models"));
    await service.call({
      command: "settings:set",
      args: [
        {
          llamaUrl: `http://127.0.0.1:${port}/v1`,
          llamaAutoStart: false,
          model: "fixture-model",
          modelsDir: join(directory, "models"),
          memoryEnabled: true,
          llamaModels: [
            { id: "fixture", name: "fixture-model", endpointId: "local", reasoningControl: "none" },
          ],
          llamaApiKey: "test-llama-key",
        },
      ],
    });
    const first = (await service.call({ command: "chats:create", args: [] })) as Conversation;
    const second = (await service.call({ command: "chats:create", args: [] })) as Conversation;
    await service.call({
      command: "chat:send",
      args: [
        {
          conversationId: first.id,
          content: "记住我的偏好，我喜欢中文回复",
          attachments: [],
          effort: "none",
          webSearch: false,
        },
      ],
    });
    await waitFor(() => events.some((event) => event.type === "chat:done"));
    const messages = (await service.call({
      command: "chats:messages",
      args: [first.id],
    })) as ChatMessage[];
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.content, "已记住：喜欢中文回复");
    assert.equal(messages[1]?.thinking, "思考过程");
    assert.ok(memoryBlock("", first.id).includes("中文"));
    assert.equal(memoryBlock("", second.id), "");
    assert.ok(
      ((await service.call({ command: "chats:search", args: ["中文"] })) as Conversation[]).some(
        (chat) => chat.id === first.id,
      ),
    );
    await service.call({ command: "chats:rename", args: [first.id, "中文偏好"] });
    const before = events.length;
    await service.call({ command: "chat:regenerate", args: [first.id, "none", false] });
    await waitFor(() => events.slice(before).some((event) => event.type === "chat:done"));
    assert.equal(
      ((await service.call({ command: "chats:messages", args: [first.id] })) as ChatMessage[])
        .length,
      2,
    );
    const cancellationStart = events.length;
    const send = service.call({
      command: "chat:send",
      args: [
        {
          conversationId: second.id,
          content: "需要停止",
          attachments: [],
          effort: "none",
          webSearch: false,
        },
      ],
    });
    await assert.rejects(
      service.call({
        command: "chat:send",
        args: [
          {
            conversationId: second.id,
            content: "重复发送",
            attachments: [],
            effort: "none",
            webSearch: false,
          },
        ],
      }),
      /正在生成/,
    );
    await send;
    await service.call({ command: "chat:stop", args: [second.id] });
    await waitFor(() =>
      events
        .slice(cancellationStart)
        .some((event) => event.type === "chat:done" && event.data.stopped),
    );
    const folder = join(directory, "attachment-folder");
    await mkdir(folder);
    await writeFile(join(folder, "note.md"), "文件正文");
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:p>文档正文</w:p>");
    await writeFile(join(folder, "sample.docx"), await zip.generateAsync({ type: "nodebuffer" }));
    const attachments = await service.call({ command: "attachments:serialize", args: [[folder]] });
    assert.ok(
      Array.isArray(attachments) &&
        attachments.some((file) => "text" in file && file.text === "文件正文"),
    );
    assert.ok(
      Array.isArray(attachments) &&
        attachments.some((file) => "text" in file && file.text === "文档正文"),
    );
    const sqlite = await readFile(join(directory, "mychat.sqlite"));
    assert.ok(!sqlite.includes(Buffer.from("test-llama-key")));
    await service.call({ command: "memory:clear", args: [] });
    assert.equal(memoryBlock("", first.id), "");
    await service.call({ command: "chats:delete", args: [second.id] });
    assert.equal(
      ((await service.call({ command: "chats:list", args: [] })) as Conversation[]).length,
      1,
    );
    assert.ok(received.length >= 3);
    assert.ok(settings.systemPromptPath.endsWith("LLAMA.md"));
  } finally {
    subscription.dispose();
    await service.disposeAllAndWait();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("MyChat RPC validation rejects unknown commands, mismatched arguments and arbitrary settings", () => {
  assert.throws(() => parseMyChatRequest({ command: "window:execute", args: [] }));
  assert.throws(() => parseMyChatRequest({ command: "settings:set", args: [{ arbitrary: true }] }));
  assert.throws(() => parseMyChatRequest({ command: "settings:set", args: [{ theme: "dark" }] }));
  assert.throws(() => parseMyChatRequest({ command: "settings:set", args: [{ fontSize: 13 }] }));
  assert.throws(() =>
    parseMyChatRequest({
      command: "chat:send",
      args: [
        {
          conversationId: "x",
          content: "hello",
          attachments: [],
          effort: "unlimited",
          webSearch: false,
        },
      ],
    }),
  );
  assert.deepEqual(parseMyChatRequest({ command: "chats:list", args: [] }), {
    command: "chats:list",
    args: [],
  });
});

test("MyChat RPC survives reopening and cancels admissions deleted during model discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mychat-admission-"));
  let entered = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      entered = true;
      await gate;
      response.end("{}");
      return;
    }
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (request.url === "/props") {
      response.end(JSON.stringify({ model_alias: "fixture-model" }));
      return;
    }
    response.writeHead(500);
    response.end("generation should not be reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let owner = createMyChatService(directory);
  const channel = ProxyChannel.fromService(owner);
  const client = ProxyChannel.toService<IMyChatService>({
    call: (command, args) => channel.call(undefined, command, structuredClone(args)),
    listen: (event, args) => channel.listen(undefined, event, args),
  });
  try {
    await mkdir(join(directory, "models"));
    await client.call({
      command: "settings:set",
      args: [
        {
          llamaUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          llamaAutoStart: false,
          modelsDir: join(directory, "models"),
          model: "fixture-model",
          chatInstructions: "持久化设置",
        },
      ],
    });
    const chat = (await client.call({ command: "chats:create", args: [] })) as Conversation;
    await client.call({ command: "chats:rename", args: [chat.id, "保留会话"] });
    const send = client.call({
      command: "chat:send",
      args: [
        {
          conversationId: chat.id,
          content: "删除期间不可写入",
          attachments: [],
          effort: "none",
          webSearch: false,
        },
      ],
    });
    await waitFor(() => entered);
    await client.call({ command: "chats:delete", args: [chat.id] });
    release?.();
    await assert.rejects(send, /请求已取消/);
    assert.deepEqual(await client.call({ command: "chats:messages", args: [chat.id] }), []);
    const saved = (await client.call({ command: "chats:create", args: [] })) as Conversation;
    await client.call({ command: "chats:rename", args: [saved.id, "跨重启保留"] });
    await owner.disposeAllAndWait();
    owner = createMyChatService(directory);
    const chats = (await owner.call({ command: "chats:list", args: [] })) as Conversation[];
    assert.equal(chats[0]?.title, "跨重启保留");
    assert.equal(
      ((await owner.call({ command: "settings:get", args: [] })) as Settings).chatInstructions,
      "持久化设置",
    );
  } finally {
    release?.();
    await owner.disposeAllAndWait();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
