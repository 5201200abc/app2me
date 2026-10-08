import { MYCHAT_SIDEBAR_WIDTH_KEY, readMyChatSidebarWidth } from "../sidebarStorage.js";
import {
  WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX,
  readStoredWorkspaceSidebarWidthPx,
} from "@/app-shell/workspaceSidebarGeometry.js";
import {
  CONVERSATION_CENTERED_EMPTY_LAYOUT_CLASS_NAME,
  getConversationContentWidthClassName,
} from "@/v4/conversationLayout.js";
import { ConversationEmptyStatePresentation } from "@/v4/ConversationEmptyStatePresentation.js";
import { IconChatBubble } from "./components/icons.js";
/* oxlint-disable eslint(max-lines) -- 保留完整 MyChat 功能单元，宿主适配独立于业务代码。 */
import { useMyChatApiContext } from "../MyChatApiContext.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer.js";
import { MessageView } from "./components/Message.js";
import { SettingsPanel, type SettingsPage } from "./components/Settings.js";
import { Sidebar } from "./components/Sidebar.js";
import { extractVideoFrames } from "./components/AttachmentControls.js";
import type {
  Attachment,
  ChatMessage,
  Conversation,
  Effort,
  LlamaStatus,
  Settings,
} from "@mycode/shared/mychat";
import { detectReasoningControl, detectReasoningEfforts } from "@mycode/shared/mychat";
import { planChatRequest } from "@mycode/shared/mychat";
import { MyChatDesktopChrome, type MyChatChromeOptions } from "../MyChatDesktopChrome.js";
import { Folder } from "@/components/icons/tabler.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

const WELCOME_PROMPTS = {
  en: ["What are we going to do?", "What would you like to talk about?"],
  zh: ["我们接下来要做什么？", "你想聊些什么？"],
} as const;

export function App({
  active = true,
  footer,
  sharedPreferences,
  chromeOptions,
}: {
  active?: boolean;
  footer?: (openSettings: () => void) => React.ReactNode;
  sharedPreferences: Pick<Settings, "theme" | "fontSize">;
  chromeOptions?: MyChatChromeOptions;
}) {
  const api = useMyChatApiContext();
  const { locale } = useMyCodeIntl();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bootError, setBootError] = useState("");
  useEffect(() => {
    setSettings((current) => (current ? { ...current, ...sharedPreferences } : current));
  }, [sharedPreferences.theme, sharedPreferences.fontSize]);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 640);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const collapse = () => {
      if (media.matches) setSidebarOpen(false);
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const defaultWidth = readStoredWorkspaceSidebarWidthPx() ?? WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX;
    try {
      // 仅对齐默认布局；保留 MyChat 手动拖拽宽度的既有读写路径，避免重开后丢失设置。
      const stored = Number(readMyChatSidebarWidth(localStorage));
      return Number.isFinite(stored) && stored >= 220 && stored <= 560 ? stored : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    if (!sidebarOpen) return;
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(220, Math.min(560, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const finalWidth = Math.max(220, Math.min(560, upEvent.clientX));
      try {
        localStorage.setItem(MYCHAT_SIDEBAR_WIDTH_KEY, String(finalWidth));
      } catch {
        // ignore
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<Effort>("xhigh");
  const [webSearch, setWebSearch] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [welcomePrompt, setWelcomePrompt] = useState<string>(WELCOME_PROMPTS.en[0]);

  const searchRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const seenShot = useRef<Set<string>>(new Set());
  const booted = useRef(false);
  const chatLoad = useRef(0);
  const welcomeIndex = useRef(0);
  const settingsWrite = useRef<Promise<void>>(Promise.resolve());

  const refreshDetectedModels = useCallback(async (restartRouter = false) => {
    const { settings: current, status: nextStatus } =
      await api.models.refreshCatalog(restartRouter);
    setSettings(current);
    setStatus(nextStatus);
    return { settings: current, status: nextStatus };
  }, []);

  const refreshLocalModels = useCallback(async () => {
    await refreshDetectedModels(true);
  }, [refreshDetectedModels]);

  const nextWelcomePrompt = useCallback(() => {
    const isZh = settings?.language === "zh";
    const list = isZh ? WELCOME_PROMPTS.zh : WELCOME_PROMPTS.en;
    setWelcomePrompt(list[welcomeIndex.current % list.length] ?? list[0]);
    welcomeIndex.current += 1;
  }, [settings?.language]);

  useEffect(() => {
    const isZh = settings?.language === "zh";
    const list = isZh ? WELCOME_PROMPTS.zh : WELCOME_PROMPTS.en;
    setWelcomePrompt(list[welcomeIndex.current % list.length] ?? list[0]);
  }, [settings?.language]);

  const refreshChats = useCallback(
    async (q = query) => {
      const list = q.trim() ? await api.chats.search(q) : await api.chats.list();
      setChats(list);
      return list;
    },
    [query],
  );

  const openChat = useCallback(
    async (id: string) => {
      const request = ++chatLoad.current;
      setActiveId(id);
      const next = await api.chats.messages(id);
      if (request === chatLoad.current) {
        setMessages(next);
        if (next.length === 0) nextWelcomePrompt();
      }
    },
    [nextWelcomePrompt],
  );

  const newChat = useCallback(async () => {
    if (streaming && activeId) {
      await api.chat.stop(activeId);
      setStreaming(false);
    }
    setQuery("");
    setChats(await api.chats.list());
    chatLoad.current += 1;
    setActiveId(null);
    setMessages([]);
    setDraft("");
    setAttachments([]);
    nextWelcomePrompt();
  }, [activeId, nextWelcomePrompt, streaming]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const refreshed = await refreshDetectedModels();
      const s = refreshed.settings;
      const initialModel = s.llamaModels.find((model) => model.name === s.model);
      const supportedEfforts = initialModel?.reasoningEfforts ?? detectReasoningEfforts(s.model);
      setEffort(
        supportedEfforts?.includes(s.defaultEffort)
          ? s.defaultEffort
          : supportedEfforts?.includes("xhigh")
            ? "xhigh"
            : supportedEfforts?.at(-1) || s.defaultEffort,
      );
      setSettings(s);
      void (s.llamaAutoStart ? api.models.ensure() : api.models.status())
        .then(setStatus)
        .catch((error) => setBootError(error instanceof Error ? error.message : String(error)));
      const list = await refreshChats("");
      if (list[0]) await openChat(list[0].id);
      else {
        setActiveId(null);
        setMessages([]);
        nextWelcomePrompt();
      }
    })().catch((error) => setBootError(error instanceof Error ? error.message : String(error)));
  }, [refreshDetectedModels]);

  useEffect(() => {
    const off = [
      api.chats.onRenamed?.((d) => {
        setChats((prev) =>
          prev.map((c) => (c.id === d.conversationId ? { ...c, title: d.title } : c)),
        );
      }),
      api.chat.onDelta((d) => {
        if (d.conversationId !== activeId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === d.messageId || (m.id === "tmp-asst" && m.role === "assistant")
              ? {
                  ...m,
                  id: d.messageId,
                  thinking: d.thinking ?? m.thinking,
                  content: d.content ?? m.content,
                  phase: d.phase ?? m.phase,
                  statusText: d.statusText ?? m.statusText,
                  research: d.research ?? m.research,
                }
              : m,
          ),
        );
      }),
      api.chat.onDone((d) => {
        if (d.conversationId !== activeId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === d.messageId || (m.id === "tmp-asst" && m.role === "assistant")
              ? {
                  ...m,
                  id: d.messageId,
                  thinking: d.thinking,
                  content: d.content,
                  durationSeconds: d.durationSeconds ?? m.durationSeconds,
                  research: d.research ?? m.research,
                  phase: "done",
                }
              : m,
          ),
        );
        setStreaming(false);
      }),
      api.chat.onError((d) => {
        if (d.conversationId !== activeId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === d.messageId || (m.id === "tmp-asst" && m.role === "assistant")
              ? { ...m, id: d.messageId, content: m.content || `Error: ${d.error}`, phase: "error" }
              : m,
          ),
        );
        setStreaming(false);
      }),
      api.screenshot.onAdded((file) => {
        if (seenShot.current.has(file.dataUrl)) return;
        seenShot.current.add(file.dataUrl);
        setAttachments((prev) => {
          if (prev.some((a) => a.dataUrl === file.dataUrl)) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: file.name,
              mime: "image/png",
              kind: "image",
              dataUrl: file.dataUrl,
            },
          ];
        });
      }),
      api.ui.onNewChat(newChat),
      api.ui.onSettings(() => {
        setSettingsPage("general");
        setSettingsOpen(true);
      }),
      api.ui.onSearch(() => {
        if (!sidebarOpen) setSidebarOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }),
      api.ui.onStop(() => {
        if (activeId) void api.chat.stop(activeId);
      }),
    ];
    return () => off.forEach((f) => f && f());
  }, [activeId, newChat, refreshChats, settings?.theme, sidebarOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsPage("general");
        setSettingsOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newChat();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f")
      ) {
        e.preventDefault();
        if (!sidebarOpen) setSidebarOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (e.key === "Escape" && settingsOpen) {
        setSettingsOpen(false);
        setSettingsPage("general");
      }
      if (e.key === "Escape" && streaming && activeId) {
        void api.chat.stop(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, activeId, newChat, settingsOpen, sidebarOpen, streaming]);

  const patchSettings = useCallback(
    async (patch: Partial<Settings>): Promise<Settings> => {
      let nextSettings: Settings | null = null;
      settingsWrite.current = settingsWrite.current
        .catch(() => {})
        .then(async () => {
          const updated = await api.settings.set(patch);
          nextSettings = updated;
          setSettings(updated);
        });
      await settingsWrite.current;
      return nextSettings ?? (settings as Settings);
    },
    [settings],
  );

  const send = async (textToSend?: string, attachmentsToSend?: Attachment[]) => {
    const text = textToSend !== undefined ? textToSend : draft;
    const rawAtts = attachmentsToSend !== undefined ? attachmentsToSend : attachments;
    if (!text.trim() && rawAtts.length === 0) return;
    if (streaming) return;

    let convId = activeId;
    if (!convId) {
      const conv = await api.chats.create();
      convId = conv.id;
      setActiveId(convId);
      setChats(await api.chats.list());
    }

    const atts = await Promise.all(
      rawAtts.map(async (att) => {
        if (
          att.kind === "video" &&
          (!att.frames || att.frames.length === 0) &&
          (att.path || att.dataUrl)
        ) {
          try {
            const source = att.dataUrl || att.path!;
            const { frames, duration, poster } = await extractVideoFrames(source);
            return { ...att, frames, duration, dataUrl: poster || att.dataUrl };
          } catch {
            return att;
          }
        }
        return att;
      }),
    );

    const plan = planChatRequest(text, webSearch, settings?.language ?? "en");
    const userMsg: ChatMessage = {
      id: "tmp-user",
      conversationId: convId,
      role: "user",
      content: text,
      thinking: "",
      attachments: atts,
      createdAt: Date.now(),
    };
    const asstMsg: ChatMessage = {
      id: "tmp-asst",
      conversationId: convId,
      role: "assistant",
      content: "",
      thinking: "",
      attachments: [],
      createdAt: Date.now(),
      phase: plan.useWeb ? "searching" : "thinking",
      phaseStartedAt: Date.now(),
      introText: plan.action,
      statusText: plan.useWeb
        ? settings?.language === "zh"
          ? "正在启动深度研究"
          : "Starting Deep Research"
        : undefined,
    };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    if (textToSend === undefined) setDraft("");
    if (attachmentsToSend === undefined) setAttachments([]);
    setStreaming(true);

    try {
      const { userId, assistantId } = await api.chat.send({
        conversationId: convId,
        content: text,
        attachments: atts,
        effort,
        webSearch,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "tmp-user"
            ? { ...m, id: userId }
            : m.id === "tmp-asst"
              ? { ...m, id: assistantId }
              : m,
        ),
      );
      setChats(await api.chats.list());
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "tmp-asst"
            ? {
                ...m,
                content: `Error: ${e instanceof Error ? e.message : String(e)}`,
                phase: "error",
              }
            : m,
        ),
      );
      setStreaming(false);
    }
  };

  const handleEditMessage = async (messageId: string, text: string, atts?: Attachment[]) => {
    if (streaming) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    setMessages((prev) => prev.slice(0, index));
    await send(text, atts);
  };

  const regenerate = async () => {
    if (!activeId || streaming) return;
    const plan = planChatRequest(
      messages.filter((m) => m.role === "user").at(-1)?.content || "",
      webSearch,
      settings?.language ?? "en",
    );
    setStreaming(true);
    setMessages((prev) => {
      const filtered = prev.filter(
        (_, i) => i !== prev.length - 1 || prev[i]?.role !== "assistant",
      );
      return [
        ...filtered,
        {
          id: "tmp-asst",
          conversationId: activeId,
          role: "assistant",
          content: "",
          thinking: "",
          attachments: [],
          createdAt: Date.now(),
          phase: plan.useWeb ? "searching" : "thinking",
          phaseStartedAt: Date.now(),
          introText: plan.action,
          statusText: plan.useWeb
            ? settings?.language === "zh"
              ? "正在启动深度研究"
              : "Starting Deep Research"
            : undefined,
        },
      ];
    });
    try {
      const res = await api.chat.regenerate(activeId, effort, webSearch);
      if (res.assistantId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === "tmp-asst" ? { ...m, id: res.assistantId! } : m)),
        );
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "tmp-asst"
            ? {
                ...m,
                content: `Error: ${e instanceof Error ? e.message : String(e)}`,
                phase: "error",
              }
            : m,
        ),
      );
      setStreaming(false);
    }
  };

  const deleteAllChats = async () => {
    await api.chats.clear();
    setChats([]);
    setActiveId(null);
    setMessages([]);
    nextWelcomePrompt();
  };

  const userScrolledUp = useRef(false);

  const handleScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceToBottom > 80;
  };

  useEffect(() => {
    const el = threadRef.current;
    if (!el || userScrolledUp.current) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streaming]);

  const visible = useMemo(() => messages.filter((m) => m.role !== "system"), [messages]);

  // 初次配置读取期间也呈现正常界面；不编造模型数据，输入操作暂时禁用。
  const language = settings?.language ?? (locale === "zh-CN" ? "zh" : "en");

  const activeEndpoint =
    settings?.llamaEndpoints.find((endpoint) => endpoint.url === settings.llamaUrl) ||
    settings?.llamaEndpoints[0];
  const configuredModels = (settings?.llamaModels ?? []).filter(
    (model) => !activeEndpoint || model.endpointId === activeEndpoint.id,
  );
  const activeModel = settings?.llamaModels.find(
    (model) =>
      model.name === settings.model && (!activeEndpoint || model.endpointId === activeEndpoint.id),
  );
  const reasoningControl =
    activeModel?.reasoningControl ?? detectReasoningControl(settings?.model ?? "");
  const reasoningEfforts =
    activeModel?.reasoningEfforts ?? detectReasoningEfforts(settings?.model ?? "");

  const selectModel = async (model: string) => {
    if (!settings) return;
    const configured = settings.llamaModels.find(
      (item) => item.name === model && (!activeEndpoint || item.endpointId === activeEndpoint.id),
    );
    const supported = configured?.reasoningEfforts ?? detectReasoningEfforts(model);
    const nextEffort = supported?.includes(effort)
      ? effort
      : supported?.includes(settings.defaultEffort)
        ? settings.defaultEffort
        : supported?.includes("xhigh")
          ? "xhigh"
          : supported?.[supported.length - 1];
    if (nextEffort) setEffort(nextEffort);
    await patchSettings({ model });
    setStatus(await api.models.status());
  };

  return (
    <>
      {bootError && (
        <div role="alert" className="mychat-error">
          {bootError}
        </div>
      )}
      <div
        className={`app ${!sidebarOpen ? "sidebar-collapsed" : ""}`}
        style={{ "--sidebar": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <Sidebar
          footer={footer?.(() => {
            setSettingsPage("general");
            setSettingsOpen(true);
          })}
          language={language}
          chats={chats}
          activeId={activeId}
          query={query}
          searchRef={searchRef}
          headerSearch={Boolean(chromeOptions?.isDesktop)}
          collapsed={!sidebarOpen}
          empty={visible.length === 0}
          onQuery={(q) => {
            setQuery(q);
            void refreshChats(q);
          }}
          onSelect={(id) => {
            if (streaming && activeId && id !== activeId) {
              void api.chat.stop(activeId);
              setStreaming(false);
            }
            void openChat(id);
          }}
          onNew={() => void newChat()}
          onDelete={async (id) => {
            const isZh = language === "zh";
            if (
              !window.confirm(
                isZh
                  ? "确定删除此对话吗？此操作无法撤销。"
                  : "Delete this chat? This cannot be undone.",
              )
            )
              return;
            await api.chats.delete(id);
            const list = query.trim() ? await api.chats.search(query) : await api.chats.list();
            setChats(list);
            if (id === activeId) {
              setStreaming(false);
              if (list[0]) await openChat(list[0].id);
              else {
                chatLoad.current += 1;
                setActiveId(null);
                setMessages([]);
                nextWelcomePrompt();
              }
            }
          }}
          onSettings={() => {
            setSettingsPage("general");
            setSettingsOpen(true);
          }}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />
        <div
          className={`sidebar-resizer ${isResizing ? "is-dragging" : ""}`}
          onMouseDown={handleResizerMouseDown}
          onDoubleClick={() => {
            setSidebarWidth(WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX);
            try {
              localStorage.setItem(
                MYCHAT_SIDEBAR_WIDTH_KEY,
                String(WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX),
              );
            } catch {
              // ignore
            }
          }}
          title={
            language === "zh"
              ? "拖拽调整侧边栏宽度，双击重置"
              : "Drag to resize sidebar, double-click to reset"
          }
        />
        <section
          data-workspace-conversation-frame="true"
          className={cn("main", chromeOptions?.frameClassName)}
        >
          <div className="mode-pane conversation-reference-surface">
            <header className="mychat-workspace-header" data-testid="mychat-workspace-header">
              {visible.length > 0 ? (
                <>
                  <Folder className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="truncate text-ui-caption font-medium">
                    {chats.find((chat) => chat.id === activeId)?.title ||
                      (language === "zh" ? "新会话" : "New chat")}
                  </span>
                </>
              ) : null}
            </header>
            <div className="mychat-conversation-body">
              <div
                data-mychat-empty={visible.length === 0 ? "true" : undefined}
                className={cn(
                  "mychat-conversation-layout",
                  visible.length === 0 && CONVERSATION_CENTERED_EMPTY_LAYOUT_CLASS_NAME,
                )}
              >
                <div
                  className={cn(
                    "thread",
                    visible.length === 0 &&
                      getConversationContentWidthClassName({
                        centeredEmptyLayout: true,
                        statusPanelLayout: "none",
                      }),
                  )}
                  ref={threadRef}
                  onScroll={handleScroll}
                >
                  <div className="thread-inner">
                    {visible.length === 0 ? (
                      <ConversationEmptyStatePresentation
                        greeting={welcomePrompt}
                        greetingTestId="mychat-welcome-title"
                        brand={
                          <span
                            data-testid="mychat-welcome-logo"
                            aria-hidden
                            className="pointer-events-none size-12 shrink-0 text-foreground-subtle opacity-45"
                          >
                            <IconChatBubble size={48} />
                          </span>
                        }
                      />
                    ) : (
                      visible.map((m, i) => (
                        <MessageView
                          key={m.id}
                          message={m}
                          language={settings?.language ?? "en"}
                          streaming={
                            streaming && i === visible.length - 1 && m.role === "assistant"
                          }
                          onRegenerate={
                            m.role === "assistant" && i === visible.length - 1
                              ? regenerate
                              : undefined
                          }
                          onEdit={
                            m.role === "user"
                              ? (id, text, atts) => void handleEditMessage(id, text, atts)
                              : undefined
                          }
                        />
                      ))
                    )}
                  </div>
                </div>
                <Composer
                  className={
                    visible.length === 0
                      ? getConversationContentWidthClassName({
                          centeredEmptyLayout: true,
                          statusPanelLayout: "none",
                        })
                      : undefined
                  }
                  disabled={!settings}
                  value={draft}
                  model={settings?.model ?? ""}
                  models={[
                    ...new Set([
                      ...configuredModels.map((model) => model.name),
                      ...(status?.models || []),
                      ...(settings?.model ? [settings.model] : []),
                    ]),
                  ]}
                  effort={effort}
                  webSearch={webSearch}
                  streaming={streaming}
                  attachments={attachments}
                  language={language}
                  onChange={setDraft}
                  onModel={(m) => void selectModel(m)}
                  onEffort={setEffort}
                  reasoningControl={reasoningControl}
                  reasoningEfforts={reasoningEfforts}
                  onWebSearch={setWebSearch}
                  onSend={() => void send()}
                  onStop={() => activeId && void api.chat.stop(activeId)}
                  onAttach={(files) => setAttachments((prev) => [...prev, ...files])}
                  onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
      {chromeOptions ? (
        <MyChatDesktopChrome
          options={chromeOptions}
          sidebarOpen={sidebarOpen}
          sidebarWidth={sidebarWidth}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onNew={() => void newChat()}
          onSettings={() => {
            setSettingsPage("general");
            setSettingsOpen(true);
          }}
          onSearch={() => {
            setSidebarOpen(true);
            window.requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
      ) : null}
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          initialPage={settingsPage}
          onChange={patchSettings}
          onRefreshModels={refreshLocalModels}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsPage("general");
          }}
          onDeleteAllMemories={async () => {
            await api.memory.clear();
          }}
          onDeleteAllChats={deleteAllChats}
        />
      )}
    </>
  );
}
