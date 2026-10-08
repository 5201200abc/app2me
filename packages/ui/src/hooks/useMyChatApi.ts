import { compactVisualAttachments } from "@/mychat/compactImages.js";
import { useEffect, useMemo, useRef } from "react";
import { DesktopCommandIds } from "@mycode/shared";
import type {
  Attachment,
  ChatMessage,
  ChatSendPayload,
  Conversation,
  Effort,
  LlamaStatus,
  ModelBenchmarkResult,
  MemoryItem,
  Settings,
  StreamDelta,
  StreamDone,
  MyChatCommands,
  MyChatRequest,
  MyChatEvents,
} from "@mycode/shared/mychat";
import { useServices } from "./useServices.js";
import { usePlatform } from "./usePlatform.js";
import { useMyCodeStore } from "@/store/StoreProvider.js";
import type { FontSize } from "@mycode/shared/mychat";
import type { Theme } from "@/useTheme.js";
type Unlisten = () => void;
export function useMyChatApi(active = true) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const services = useServices();
  const platform = usePlatform();
  const theme = useMyCodeStore((state) => state.theme);
  const fontSize = useMyCodeStore((state) => state.uiFontSizePx);
  const setTheme = useMyCodeStore((state) => state.setTheme);
  const setFontSize = useMyCodeStore((state) => state.setUiFontSizePx);
  const preferences = useRef({ theme, fontSize });
  preferences.current = { theme, fontSize };
  const terminal = useRef<{ id: string; disposers: (() => void)[] } | null>(null);
  useEffect(
    () => () => {
      const current = terminal.current;
      if (current) {
        current.disposers.forEach((dispose) => dispose());
        void services.terminalService.dispose({ id: current.id });
      }
      terminal.current = null;
    },
    [services],
  );
  const api = useMemo(() => {
    const service = services.myChatService;
    const local = new EventTarget();
    const emitLocal = (type: string, data: unknown) =>
      local.dispatchEvent(new CustomEvent(type, { detail: data }));
    const onLocal = <T>(type: string, listener: (data: T) => void): Unlisten => {
      const handler = (event: Event) => listener((event as CustomEvent<T>).detail);
      local.addEventListener(type, handler);
      return () => local.removeEventListener(type, handler);
    };
    const on = <K extends keyof MyChatEvents>(
      type: K,
      listener: (data: MyChatEvents[K]) => void,
    ): Unlisten => {
      if (!service) throw new Error("当前宿主未提供 MyChat 服务");
      const subscription = service.onEvent((event) => {
        if (event.type === type) listener(event.data as MyChatEvents[K]);
      });
      return () => subscription.dispose();
    };
    const call = <K extends keyof MyChatCommands>(
      command: K,
      ...args: MyChatCommands[K]["args"]
    ): Promise<MyChatCommands[K]["result"]> => {
      if (!service) return Promise.reject(new Error("当前宿主未提供 MyChat 服务"));
      return service.call({ command, args } as MyChatRequest) as Promise<
        MyChatCommands[K]["result"]
      >;
    };
    const present = (settings: Settings): Settings => ({
      ...settings,
      theme:
        preferences.current.theme === "system"
          ? "system"
          : preferences.current.theme.endsWith("dark")
            ? "dark"
            : "light",
      fontSize: preferences.current.fontSize as FontSize,
    });
    const setSettings = async (patch: Partial<Settings>): Promise<Settings> => {
      const { theme: nextTheme, fontSize: nextFontSize, ...business } = patch;
      const saved = await call("settings:set", business);
      if (nextTheme) {
        const value: Theme =
          nextTheme === "system" ? "system" : nextTheme === "dark" ? "mycode-dark" : "mycode-light";
        setTheme(value);
        preferences.current.theme = value;
      }
      if (nextFontSize !== undefined) {
        const number =
          typeof nextFontSize === "number" ? nextFontSize : nextFontSize === "small" ? 13 : 14;
        setFontSize(number);
        preferences.current.fontSize = Math.min(14, Math.max(11, number));
      }
      return present(saved);
    };
    const pick = async (kind: "all" | "files" | "folder"): Promise<Attachment[]> => {
      const directory = kind === "folder" ? await platform.selectDirectory() : null;
      const paths =
        kind === "folder"
          ? directory
            ? [directory]
            : []
          : kind === "all" && platform.selectFilesAndFolders
            ? await platform.selectFilesAndFolders()
            : platform.selectFiles
              ? await platform.selectFiles()
              : [];
      if (!paths.length) return [];
      const attachments = await call("attachments:serialize", paths);
      return Promise.all(
        attachments.map(async (attachment) => {
          if (
            attachment.kind !== "video" ||
            !attachment.path ||
            attachment.frames?.length ||
            !services.mediaPreviewService
          )
            return attachment;
          const preview = await services.mediaPreviewService.prepare({
            path: attachment.path,
            expectedKind: "video",
          });
          return {
            ...attachment,
            dataUrl:
              preview.kind === "inline"
                ? `data:${preview.mediaType};base64,${preview.dataBase64}`
                : preview.url,
          };
        }),
      );
    };
    const capture = async (): Promise<boolean> => {
      if (!platform.captureInteractiveScreenshot)
        throw new Error("当前平台不支持交互式截图，请粘贴图片");
      const image = await platform.captureInteractiveScreenshot();
      if (image) emitLocal("screenshot:added", image);
      return Boolean(image);
    };
    const initializeTerminal = async (options?: { cols?: number; rows?: number; cwd?: string }) => {
      if (terminal.current) return { ok: true, cwd: options?.cwd };
      try {
        const created = await services.terminalService.create({
          cols: options?.cols || 100,
          rows: options?.rows || 12,
          cwd: options?.cwd,
        });
        const dataSubscription = services.terminalService.onDynamicData(created.id)((data) =>
          emitLocal("terminal:data", data),
        );
        const exitSubscription = services.terminalService.onDynamicExit(created.id)((code) =>
          emitLocal("terminal:exit", code),
        );
        terminal.current = {
          id: created.id,
          disposers: [() => dataSubscription.dispose(), () => exitSubscription.dispose()],
        };
        return { ok: true, cwd: options?.cwd };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
    const restartTerminal = async (options?: { cols?: number; rows?: number; cwd?: string }) => {
      const current = terminal.current;
      if (current) {
        current.disposers.forEach((dispose) => dispose());
        await services.terminalService.dispose({ id: current.id });
        terminal.current = null;
      }
      return initializeTerminal(options);
    };
    const writeTerminal = async (data: string): Promise<boolean> => {
      if (!terminal.current) return false;
      await services.terminalService.write({ id: terminal.current.id, data });
      return true;
    };
    const resizeTerminal = async (cols: number, rows: number): Promise<boolean> => {
      if (!terminal.current) return false;
      await services.terminalService.resize({ id: terminal.current.id, cols, rows });
      return true;
    };
    return {
      notifyNewChat: () => {
        if (activeRef.current) emitLocal("ui:new-chat", undefined);
      },
      settings: {
        get: (): Promise<Settings> => call("settings:get").then(present),
        set: (patch: Partial<Settings>): Promise<Settings> => setSettings(patch),
      },
      models: {
        status: (): Promise<LlamaStatus> => call("models:status"),
        ensure: (): Promise<LlamaStatus> => call("models:ensure"),
        reconnect: (): Promise<LlamaStatus> => call("models:reconnect"),
        stop: (): Promise<LlamaStatus> => call("models:stop"),
        benchmark: (model: string): Promise<ModelBenchmarkResult> =>
          call("models:benchmark", model),
        refreshCatalog: (
          restartRouter = false,
        ): Promise<{ settings: Settings; status: LlamaStatus }> =>
          call("models:refreshCatalog", restartRouter).then((result) => ({
            ...result,
            settings: present(result.settings),
          })),
      },
      chats: {
        list: (): Promise<Conversation[]> => call("chats:list"),
        search: (q: string): Promise<Conversation[]> => call("chats:search", q),
        create: (): Promise<Conversation> => call("chats:create"),
        rename: (id: string, title: string): Promise<boolean> => call("chats:rename", id, title),
        delete: (id: string): Promise<boolean> => call("chats:delete", id),
        clear: (): Promise<boolean> => call("chats:clear"),
        messages: (id: string): Promise<ChatMessage[]> => call("chats:messages", id),
        autoSummarize: (): Promise<Conversation[]> => call("chats:autoSummarize"),
        onRenamed: (fn: (d: { conversationId: string; title: string }) => void): Unlisten =>
          on("chats:renamed", fn),
      },
      memory: {
        list: (): Promise<MemoryItem[]> => call("memory:list"),
        clear: (): Promise<boolean> => call("memory:clear"),
      },
      chat: {
        send: async (payload: ChatSendPayload) =>
          call("chat:send", {
            ...payload,
            attachments: await compactVisualAttachments(payload.attachments),
          }) as Promise<{ userId: string; assistantId: string }>,
        stop: (conversationId: string): Promise<boolean> => call("chat:stop", conversationId),
        regenerate: (conversationId: string, effort: Effort, webSearch: boolean) =>
          call("chat:regenerate", conversationId, effort, webSearch) as Promise<{
            ok: boolean;
            assistantId?: string;
          }>,
        onDelta: (fn: (d: StreamDelta) => void): Unlisten => on("chat:delta", fn),
        onDone: (fn: (d: StreamDone) => void): Unlisten => on("chat:done", fn),
        onError: (
          fn: (d: { conversationId: string; messageId: string; error: string }) => void,
        ): Unlisten => on("chat:error", fn),
      },
      screenshot: {
        capture: (): Promise<boolean> => capture(),
        ack: (dataUrl: string): Promise<boolean> => Promise.resolve(Boolean(dataUrl)),
        onAdded: (fn: (file: { name: string; dataUrl: string }) => void): Unlisten =>
          onLocal("screenshot:added", fn),
      },
      terminal: {
        init: (opts?: {
          cols?: number;
          rows?: number;
          cwd?: string;
        }): Promise<{ ok: boolean; cwd?: string; error?: string }> => initializeTerminal(opts),
        write: (data: string): Promise<boolean> => writeTerminal(data),
        resize: (cols: number, rows: number): Promise<boolean> => resizeTerminal(cols, rows),
        restart: (opts?: {
          cols?: number;
          rows?: number;
          cwd?: string;
        }): Promise<{ ok: boolean; cwd?: string; error?: string }> => restartTerminal(opts),
        selectFolder: (): Promise<string | null> => platform.selectDirectory(),
        onData: (fn: (data: string) => void): Unlisten => onLocal("terminal:data", fn),
        onExit: (fn: (exitCode: number) => void): Unlisten => onLocal("terminal:exit", fn),
      },
      ui: {
        toggleMaximize: (): Promise<boolean> =>
          platform.executeDesktopCommand(DesktopCommandIds.ToggleMaximizeWindow).then(Boolean),
        onSettings: (fn: () => void): Unlisten => onLocal("ui:settings", fn),
        onNewChat: (fn: () => void): Unlisten => onLocal("ui:new-chat", fn),
        onSearch: (fn: () => void): Unlisten => onLocal("ui:search", fn),
        onStop: (fn: () => void): Unlisten => onLocal("ui:stop", fn),
        onTheme: (fn: (dark: boolean) => void): Unlisten => onLocal("ui:theme", fn),
      },
      attachments: {
        pickFilesAndFolders: (): Promise<Attachment[]> => pick("all"),
        pickFiles: (): Promise<Attachment[]> => pick("files"),
        pickFolder: (): Promise<Attachment[]> => pick("folder"),
      },
    };
  }, [services, platform, setTheme, setFontSize]);
  useEffect(() => platform.onNewTask(api.notifyNewChat), [platform, api]);
  return api;
}
export type MyChatApi = ReturnType<typeof useMyChatApi>;
