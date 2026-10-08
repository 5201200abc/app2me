import { Emitter } from "@mycode/rpc";
import {
  parseMyChatRequest,
  type MyChatEvent,
  type MyChatEvents,
  type MyChatRequest,
  type MyChatResult,
} from "@mycode/shared/mychat";
import { initDb, closeDb } from "./db.js";
import { initializeSettings } from "./store.js";
import { serializePaths } from "./attachments.js";
import type { IMyChatService } from "../myChat.js";
import type { Attachment, ChatSendPayload, Effort, Settings } from "@mycode/shared/mychat";
import {
  createConversation,
  deleteAllConversations,
  deleteConversation,
  deleteMessage,
  getConversation,
  insertMessage,
  listConversations,
  listMemories,
  listMessages,
  renameConversation,
  searchConversations,
  updateMessage,
  clearMemories,
} from "./db.js";
import { streamChat } from "./llama.js";
import {
  releaseManagedLlama,
  benchmarkLocalModel,
  ensureLocalLlama,
  probeLlama,
  stopLocalLlama,
} from "./models.js";
import { getSettings, setSettings } from "./store.js";
import { maybeRemember } from "./memory.js";
import { generateConversationTitle, immediateConversationTitle } from "./title.js";
import { reconcileModelCatalog } from "@mycode/shared/mychat";

export function createMyChatService(
  dataDir: string,
): IMyChatService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } {
  const aborts = new Map<string, AbortController>();
  const admissions = new Set<string>();
  const events = new Emitter<MyChatEvent>();
  let initialized: Promise<void> | null = null;
  let disposed = false;
  let disposal: Promise<void> | null = null;
  const ready = () => (initialized ??= initDb(dataDir).then(initializeSettings));
  function emit<K extends keyof MyChatEvents>(type: K, data: MyChatEvents[K]): void {
    events.fire({ type, data } as MyChatEvent);
  }
  function broadcastConversationTitle(conversationId: string, title: string): void {
    renameConversation(conversationId, title);
    emit("chats:renamed", { conversationId, title });
  }

  async function beginStream(opts: {
    conversationId: string;
    content: string;
    attachments: Attachment[];
    effort: Effort;
    webSearch: boolean;
    insertUser: boolean;
    replaceAssistantId?: string;
    abort: AbortController;
  }): Promise<{ userId: string; assistantId: string }> {
    let settings = getSettings();
    const status = settings.llamaAutoStart
      ? await ensureLocalLlama(settings)
      : await probeLlama(settings);
    if (!status.online) {
      throw new Error("模型服务未就绪，请先启动 llama-server。");
    }
    if (status.managed && status.url !== settings.llamaUrl) {
      settings = {
        ...settings,
        llamaUrl: status.url,
        llamaPort: status.port || settings.llamaPort,
      };
    }
    if (status.runningModelPath && status.runningModel && status.runningModel !== settings.model) {
      throw new Error(
        status.error || `当前服务加载的是 ${status.runningModel}，不是所选 ${settings.model}。`,
      );
    }

    // 模型探测是异步的，停止或删除期间取消的请求不能继续写入会话。
    if (disposed || opts.abort.signal.aborted || !getConversation(opts.conversationId))
      throw new Error("请求已取消");
    const history = listMessages(opts.conversationId);
    const isFirstTurn =
      history.length === 0 || history.filter((m) => m.role === "user").length === 0;
    let initialConversationTitle: string | null = null;

    const abort = opts.abort;

    let userId: string = crypto.randomUUID();
    if (opts.insertUser) {
      insertMessage({
        id: userId,
        conversationId: opts.conversationId,
        role: "user",
        content: opts.content,
        thinking: "",
        attachments: opts.attachments,
        createdAt: Date.now(),
      });
    } else {
      userId = [...history].reverse().find((m) => m.role === "user")?.id || "";
    }

    if (isFirstTurn && opts.insertUser && opts.content.trim()) {
      const title = immediateConversationTitle(opts.content);
      if (title.trim()) {
        const initialTitle = title.trim();
        initialConversationTitle = initialTitle;
        broadcastConversationTitle(opts.conversationId, initialTitle);
      }
    }

    // 重新生成必须替换持久化的旧答案，否则重新加载会出现重复回复。
    if (opts.replaceAssistantId) deleteMessage(opts.replaceAssistantId);
    const assistantId = crypto.randomUUID();
    const startedAt = Date.now();
    insertMessage({
      id: assistantId,
      conversationId: opts.conversationId,
      role: "assistant",
      content: "",
      thinking: "",
      attachments: [],
      createdAt: startedAt + 1,
    });

    const userMsg = {
      id: userId,
      conversationId: opts.conversationId,
      role: "user" as const,
      content: opts.content,
      thinking: "",
      attachments: opts.attachments,
      createdAt: Date.now(),
    };

    const hist = opts.insertUser
      ? history
      : history.filter((m) => m.id !== userId && m.id !== opts.replaceAssistantId);
    void streamChat({
      settings,
      conversationId: opts.conversationId,
      history: hist,
      userText: opts.content,
      attachments: opts.attachments,
      effort: opts.effort,
      webSearch: opts.webSearch,
      vision: status.vision,
      abort,
      handlers: {
        onStatus: (statusUpdate) => {
          if (disposed) return;
          if (aborts.get(opts.conversationId) !== abort) return;
          emit("chat:delta", {
            conversationId: opts.conversationId,
            messageId: assistantId,
            phase: statusUpdate.phase,
            statusText: statusUpdate.text,
          });
        },
        onDelta: (chunk) => {
          if (disposed) return;
          if (aborts.get(opts.conversationId) !== abort) return;
          emit("chat:delta", {
            conversationId: opts.conversationId,
            messageId: assistantId,
            ...chunk,
          });
        },
        onResearch: (research) => {
          if (disposed) return;
          if (aborts.get(opts.conversationId) !== abort) return;
          emit("chat:delta", {
            conversationId: opts.conversationId,
            messageId: assistantId,
            phase: "searching",
            research,
          });
        },
        onDone: (result) => {
          if (disposed) return;
          if (aborts.get(opts.conversationId) !== abort) {
            deleteMessage(assistantId);
            return;
          }
          const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          updateMessage(assistantId, {
            content: result.content,
            thinking: result.thinking,
            research: result.research,
            durationSeconds,
          });
          if (settings.memoryEnabled && !result.stopped && result.content.trim()) {
            maybeRemember(userMsg, {
              ...userMsg,
              id: assistantId,
              role: "assistant",
              content: result.content,
              thinking: result.thinking,
              attachments: [],
            });
          }
          aborts.delete(opts.conversationId);
          emit("chat:done", {
            conversationId: opts.conversationId,
            messageId: assistantId,
            thinking: result.thinking,
            content: result.content,
            stopped: result.stopped,
            research: result.research,
            durationSeconds,
          });
          if (initialConversationTitle && result.content.trim()) {
            const initialTitle = initialConversationTitle;
            void generateConversationTitle(opts.content, result.content, settings)
              .then((generatedTitle) => {
                if (
                  !disposed &&
                  generatedTitle !== initialTitle &&
                  getConversation(opts.conversationId)?.title === initialTitle
                ) {
                  broadcastConversationTitle(opts.conversationId, generatedTitle);
                }
              })
              .catch(() => undefined);
          }
        },
        onError: (error) => {
          if (disposed) return;
          if (aborts.get(opts.conversationId) !== abort) {
            deleteMessage(assistantId);
            return;
          }
          updateMessage(assistantId, { content: `生成失败：${error}` });
          aborts.delete(opts.conversationId);
          emit("chat:error", {
            conversationId: opts.conversationId,
            messageId: assistantId,
            error,
          });
        },
      },
    });

    return { userId, assistantId };
  }

  const handlers = {
    "settings:get": () => getSettings(),
    "settings:set": (patch: Partial<Settings>) => setSettings(patch),
    "models:status": async () => probeLlama(getSettings()),
    "models:ensure": async () => ensureLocalLlama(getSettings(), false),
    "models:reconnect": async () => ensureLocalLlama(getSettings(), true),
    "models:stop": async () => stopLocalLlama(getSettings()),
    "models:benchmark": async (model: string) => benchmarkLocalModel(getSettings(), model),
    "models:refreshCatalog": async (restartRouter = false) => {
      let settings = getSettings();
      const status = restartRouter
        ? await ensureLocalLlama(settings, true)
        : await probeLlama(settings);
      const detectedModels = reconcileModelCatalog(settings, status);
      const selectedExists = detectedModels.some((model) => model.name === settings.model);
      const nextModel = selectedExists ? settings.model : detectedModels[0]?.name || "";
      if (
        JSON.stringify(detectedModels) !== JSON.stringify(settings.llamaModels) ||
        nextModel !== settings.model
      ) {
        settings = await setSettings({
          llamaModels: detectedModels,
          modelCatalog: detectedModels.map((model) => model.name),
          model: nextModel,
        });
      }
      return { settings, status };
    },

    "chats:list": () => listConversations(),
    "chats:search": (q: string) => searchConversations(q),
    "chats:create": () => createConversation(),
    "chats:rename": (id: string, title: string) => {
      renameConversation(id, title);
      return true;
    },
    "chats:delete": (id: string) => {
      aborts.get(id)?.abort();
      aborts.delete(id);
      deleteConversation(id);
      return true;
    },
    "chats:clear": () => {
      for (const abort of aborts.values()) abort.abort();
      aborts.clear();
      deleteAllConversations();
      return true;
    },
    "chats:messages": (id: string) => listMessages(id),

    // Compatibility API: titles are now generated once, before the first response starts.
    "chats:autoSummarize": () => listConversations(),

    "memory:list": () => listMemories(),
    "memory:clear": () => {
      clearMemories();
      return true;
    },

    "chat:stop": (conversationId: string) => {
      aborts.get(conversationId)?.abort();
      return true;
    },

    "chat:send": async (payload: ChatSendPayload) => {
      return admit(payload.conversationId, (abort) =>
        beginStream({
          abort,
          conversationId: payload.conversationId,
          content: payload.content,
          attachments: payload.attachments,
          effort: payload.effort,
          webSearch: payload.webSearch,
          insertUser: true,
        }),
      );
    },

    "chat:regenerate": async (conversationId: string, effort: Effort, webSearch: boolean) => {
      const messages = listMessages(conversationId);
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return { ok: false as const };
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const ids = await admit(conversationId, (abort) =>
        beginStream({
          abort,
          conversationId,
          content: lastUser.content,
          attachments: lastUser.attachments,
          effort,
          webSearch,
          insertUser: false,
          replaceAssistantId: lastAssistant?.id,
        }),
      );
      return { ok: true as const, ...ids };
    },
    "attachments:serialize": (paths: string[]) => serializePaths(paths),
  };
  async function admit<T>(id: string, action: (abort: AbortController) => Promise<T>): Promise<T> {
    // 确保模型启动的 await 期间也只有一个请求获得同一会话的写入权。
    if (admissions.has(id) || aborts.has(id)) throw new Error("当前会话正在生成回复");
    if (!getConversation(id)) throw new Error("会话不存在");
    admissions.add(id);
    const abort = new AbortController();
    aborts.set(id, abort);
    try {
      return await action(abort);
    } catch (error) {
      if (aborts.get(id) === abort) aborts.delete(id);
      throw error;
    } finally {
      admissions.delete(id);
    }
  }
  return {
    onEvent: events.event,
    async call(request: MyChatRequest): Promise<MyChatResult> {
      if (disposed) throw new Error("MyChat service has been disposed");
      const input = parseMyChatRequest(request);
      await ready();
      if (disposed) throw new Error("MyChat service has been disposed");
      const handler = handlers[input.command] as (
        ...args: never[]
      ) => MyChatResult | Promise<MyChatResult>;
      return await handler(...(input.args as never[]));
    },
    disposeAll(): void {
      if (disposed) return;
      disposed = true;
      for (const abort of aborts.values()) abort.abort();
      aborts.clear();
      events.dispose();
      releaseManagedLlama();
      disposal = Promise.resolve(initialized)
        .catch(() => undefined)
        .then(() => closeDb());
    },
    async disposeAllAndWait(): Promise<void> {
      this.disposeAll();
      await disposal;
    },
  };
}
