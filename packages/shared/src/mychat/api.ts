import { z } from "zod";
import type {
  Attachment,
  ChatMessage,
  ChatSendPayload,
  Conversation,
  Effort,
  LlamaStatus,
  MemoryItem,
  ModelBenchmarkResult,
  Settings,
  StreamDelta,
  StreamDone,
} from "./types.js";
export type MyChatBusinessSettingsPatch = Partial<Omit<Settings, "theme" | "fontSize">>;
export interface MyChatCommands {
  "settings:get": { args: []; result: Settings };
  "settings:set": { args: [MyChatBusinessSettingsPatch]; result: Settings };
  "models:status": { args: []; result: LlamaStatus };
  "models:ensure": { args: []; result: LlamaStatus };
  "models:reconnect": { args: []; result: LlamaStatus };
  "models:stop": { args: []; result: LlamaStatus };
  "models:benchmark": { args: [string]; result: ModelBenchmarkResult };
  "models:refreshCatalog": { args: [boolean]; result: { settings: Settings; status: LlamaStatus } };
  "chats:list": { args: []; result: Conversation[] };
  "chats:search": { args: [string]; result: Conversation[] };
  "chats:create": { args: []; result: Conversation };
  "chats:rename": { args: [string, string]; result: boolean };
  "chats:delete": { args: [string]; result: boolean };
  "chats:clear": { args: []; result: boolean };
  "chats:messages": { args: [string]; result: ChatMessage[] };
  "chats:autoSummarize": { args: []; result: Conversation[] };
  "memory:list": { args: []; result: MemoryItem[] };
  "memory:clear": { args: []; result: boolean };
  "chat:send": { args: [ChatSendPayload]; result: { userId: string; assistantId: string } };
  "chat:stop": { args: [string]; result: boolean };
  "chat:regenerate": {
    args: [string, Effort, boolean];
    result: { ok: boolean; assistantId?: string };
  };
  "attachments:serialize": { args: [string[]]; result: Attachment[] };
}
export type MyChatCommand = keyof MyChatCommands;
export type MyChatRequest = {
  [K in MyChatCommand]: { command: K; args: MyChatCommands[K]["args"] };
}[MyChatCommand];
export type MyChatResult = MyChatCommands[MyChatCommand]["result"];
export interface MyChatEvents {
  "chat:delta": StreamDelta;
  "chat:done": StreamDone;
  "chat:error": { conversationId: string; messageId: string; error: string };
  "chats:renamed": { conversationId: string; title: string };
}
export type MyChatEvent = {
  [K in keyof MyChatEvents]: { type: K; data: MyChatEvents[K] };
}[keyof MyChatEvents];
const effort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const attachment = z
  .object({
    id: z.string(),
    mime: z.string(),
    name: z.string(),
    dataUrl: z.string().optional(),
    frames: z.array(z.string()).optional(),
    duration: z.number().optional(),
    path: z.string().optional(),
    relativePath: z.string().optional(),
    size: z.number().optional(),
    kind: z
      .enum(["image", "video", "audio", "document", "text", "code", "archive", "pdf", "file"])
      .optional(),
    text: z.string().optional(),
  })
  .strict();
const key = z.object({ id: z.string(), name: z.string(), key: z.string() }).strict();
const model = z
  .object({
    id: z.string(),
    name: z.string(),
    endpointId: z.string(),
    reasoningControl: z.enum(["effort", "toggle", "none"]).optional(),
    reasoningEfforts: z.array(effort).optional(),
    source: z.enum(["local", "remote"]).optional(),
  })
  .strict();
export const myChatSettingsPatchSchema = z
  .object({
    llamaUrl: z.string(),
    llamaPort: z.number().int(),
    llamaAutoStart: z.boolean(),
    llamaApiKey: z.string(),
    model: z.string(),
    tavilyApiKey: z.string(),
    firecrawlUrl: z.string(),
    firecrawlApiKey: z.string(),
    researchExtractor: z.enum(["tavily", "firecrawl"]),
    tavilyExtractDepth: z.enum(["basic", "advanced"]),
    defaultEffort: effort,
    memoryEnabled: z.boolean(),
    modelsDir: z.string(),
    systemPrompt: z.string(),
    systemPromptPath: z.string(),
    chatInstructions: z.string(),
    language: z.enum(["en", "zh"]),
    modelCatalog: z.array(z.string()),
    llamaModels: z.array(model),
    llamaEndpoints: z.array(
      z.object({ id: z.string(), name: z.string(), url: z.string() }).strict(),
    ),
    tavilyApiKeys: z.array(key),
    llamaApiKeys: z.array(key),
  })
  .partial()
  .strict();
const schemas: Record<MyChatCommand, z.ZodType> = {
  "settings:get": z.tuple([]),
  "settings:set": z.tuple([myChatSettingsPatchSchema]),
  "models:status": z.tuple([]),
  "models:ensure": z.tuple([]),
  "models:reconnect": z.tuple([]),
  "models:stop": z.tuple([]),
  "models:benchmark": z.tuple([z.string()]),
  "models:refreshCatalog": z.tuple([z.boolean()]),
  "chats:list": z.tuple([]),
  "chats:search": z.tuple([z.string()]),
  "chats:create": z.tuple([]),
  "chats:rename": z.tuple([z.string(), z.string()]),
  "chats:delete": z.tuple([z.string()]),
  "chats:clear": z.tuple([]),
  "chats:messages": z.tuple([z.string()]),
  "chats:autoSummarize": z.tuple([]),
  "memory:list": z.tuple([]),
  "memory:clear": z.tuple([]),
  "chat:send": z.tuple([
    z
      .object({
        conversationId: z.string(),
        content: z.string(),
        attachments: z.array(attachment),
        effort,
        webSearch: z.boolean(),
      })
      .strict(),
  ]),
  "chat:stop": z.tuple([z.string()]),
  "chat:regenerate": z.tuple([z.string(), effort, z.boolean()]),
  "attachments:serialize": z.tuple([z.array(z.string()).max(120)]),
};
export function parseMyChatRequest(value: unknown): MyChatRequest {
  const input = z
    .object({ command: z.string(), args: z.array(z.unknown()) })
    .strict()
    .parse(value);
  if (!Object.hasOwn(schemas, input.command)) throw new Error("Unknown MyChat command");
  const command = input.command as MyChatCommand;
  return { command, args: schemas[command].parse(input.args) } as MyChatRequest;
}
