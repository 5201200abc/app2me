import { ChevronDown, ChevronUp } from "@/components/icons/tabler.js";
/* oxlint-disable eslint(max-lines) -- 保留完整 MyChat 功能单元，宿主适配独立于业务代码。 */
import { useMyChatApiContext } from "../../MyChatApiContext.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Language, LlamaStatus, ModelBenchmarkResult, Settings } from "@mycode/shared/mychat";
import {
  detectReasoningControl,
  detectReasoningEfforts,
  reasoningControlLabel,
} from "@mycode/shared/mychat";
import { IconGauge, IconGear, IconTrash } from "./icons.js";

export type SettingsPage = "general" | "models" | "research" | "apikeys" | "instructions" | "data";
type Page = SettingsPage;
type Action = "chat" | "rule" | "memory" | "chats" | "setting";
type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => Promise<void | Settings>;
  onClose: () => void;
  onDeleteAllMemories?: () => Promise<void>;
  onDeleteAllChats: () => Promise<void | boolean>;
  initialPage?: Page;
  onRefreshModels?: () => Promise<void>;
};

const COPY = {
  en: {
    settings: "Settings",
    back: "Back to app",
    general: "General",
    models: "Models",
    webResearch: "Web Research",
    apiKeys: "API Key",
    instructions: "Instructions",
    data: "Data",
    language: "Language",
    languageHelp: "Choose the interface language.",
    fontSize: "Font size",
    fontHelp: "Adjust font size.",
    theme: "Theme",
    modelService: "Llama",
    modelServiceHelp: "Local llama-server instance.",
    autoStart: "Start automatically",
    start: "Start",
    stop: "Stop",
    restart: "Restart",
    running: "Running",
    stopped: "Stopped",
    llamaConfig: "Model Configuration",
    llamaConfigHelp: "Manage the permanent local multi-model router.",
    configure: "Configure",
    active: "Active",
    use: "Use",
    name: "Name",
    url: "API URL",
    refreshModels: "Model Refresh",
    testSpeed: "Test speed",
    testingSpeed: "Testing",
    defaultEffort: "Default effort",
    defaultEffortHelp: "Default reasoning strength for models.",
    low: "Low",
    mediumLabel: "Medium",
    high: "High",
    xhigh: "Extra high (xhigh)",
    tavilyTitle: "Tavily API",
    tavilyHelp: "",
    tavilyKeys: "Tavily API",
    tavilyKeysHelp: "Configure the cloud Tavily API used by Search and Extract.",
    cloud: "Cloud",
    selfHosted: "Self-hosted",
    pageExtractor: "Page extractor",
    extractDepth: "Tavily Extract depth",
    extractDepthHelp: "Advanced handles tables, embedded content, and complex pages more reliably.",
    basic: "Basic",
    advanced: "Advanced",
    firecrawlTitle: "Firecrawl",
    firecrawlHelp:
      "Optional self-hosted full-page extractor. MyChat never routes it to Firecrawl Cloud.",
    firecrawlUrl: "API URL",
    firecrawlKey: "API key (optional for self-hosted)",
    firecrawlConfigure: "Configure Firecrawl",
    llamaKeyTitle: "Llama API",
    llamaKeyHelp: "Optional authorization token for custom llama server.",
    llamaKeys: "Llama API",
    llamaKeysHelp: "Configure and manage multiple Llama authorization API keys.",
    addKey: "Add API key",
    keyName: "Key label",
    apiKey: "API Key",
    noKey: "No API keys configured yet.",
    custom: "Custom instructions",
    customHelp: "Custom instructions and behavior rules for chat.",
    chatCustom: "Chat custom instructions",
    addCustomInstructions: "Add your custom instructions",
    rule: "Model rule style",
    modify: "Modify",
    lock: "Lock",
    saveLock: "Save & lock",
    protected: "Style rule protected",
    protectedHelp:
      "Includes concise reasoning and loop prevention. Modify only to change output style.",
    memory: "Enable memories",
    memoryHelp: "Keeps key facts and context inside the current conversation only.",
    deleteMemory: "Delete all memories",
    deleteChat: "Delete all chats",
    dataHelp: "These actions permanently affect local data.",
    save: "Save",
    saved: "Saved",
    saving: "Saving",
    unsaved: "Unsaved changes",
    cancel: "Cancel",
    close: "Close",
  },
  zh: {
    settings: "设置",
    back: "返回应用",
    general: "通用",
    models: "模型",
    webResearch: "Web Research",
    apiKeys: "API Key",
    instructions: "指令",
    data: "数据",
    language: "语言",
    languageHelp: "选择界面显示语言。",
    fontSize: "字体大小",
    fontHelp: "调整界面字体大小。",
    theme: "主题",
    modelService: "Llama",
    modelServiceHelp: "本地 llama-server 服务实例。",
    autoStart: "自动启动",
    start: "启动",
    stop: "停止",
    restart: "重启",
    running: "运行中",
    stopped: "已停止",
    llamaConfig: "Model Configuration",
    llamaConfigHelp: "管理永久运行的本地多模型路由服务。",
    configure: "配置",
    active: "当前",
    use: "使用",
    name: "名称",
    url: "API 地址",
    refreshModels: "模型刷新",
    testSpeed: "测速",
    testingSpeed: "测试中",
    defaultEffort: "默认思考强度",
    defaultEffortHelp: "模型的默认推理/思考强度级别。",
    low: "低 (low)",
    mediumLabel: "中 (medium)",
    high: "高 (high)",
    xhigh: "极高 (xhigh)",
    tavilyTitle: "Tavily API",
    tavilyHelp: "",
    tavilyKeys: "Tavily API",
    tavilyKeysHelp: "配置供 Tavily Search 与 Extract 共用的云端 API。",
    cloud: "云端",
    selfHosted: "自托管",
    pageExtractor: "网页抓取器",
    extractDepth: "Tavily Extract 深度",
    extractDepthHelp: "Advanced 更适合表格、嵌入内容与复杂页面。",
    basic: "Basic",
    advanced: "Advanced",
    firecrawlTitle: "Firecrawl",
    firecrawlHelp: "可选的自托管全文抓取器；MyChat 不会将它指向 Firecrawl Cloud。",
    firecrawlUrl: "API 地址",
    firecrawlKey: "API 密钥（自托管可选）",
    firecrawlConfigure: "配置 Firecrawl",
    llamaKeyTitle: "Llama API",
    llamaKeyHelp: "用于远程自定义 Llama 服务的授权令牌。",
    llamaKeys: "Llama API",
    llamaKeysHelp: "配置并管理多个 Llama 服务授权密钥。",
    addKey: "新增 API 密钥",
    keyName: "密钥备注名称",
    apiKey: "API 密钥",
    noKey: "暂无配置的 API 密钥。",
    custom: "自定义指令",
    customHelp: "设置 Chat 自定义指令与模型行为规则。",
    chatCustom: "Chat 自定义指令",
    addCustomInstructions: "添加你的自定义指令",
    rule: "模型规则风格",
    modify: "修改",
    lock: "锁定",
    saveLock: "保存并锁定",
    protected: "规则已保护",
    protectedHelp: "包含简洁推理和防止循环的规则，仅在需要改变输出风格时修改。",
    memory: "启用记忆",
    memoryHelp: "仅在当前对话内保留关键信息与上下文，不与其他对话混用。",
    deleteMemory: "删除全部记忆",
    deleteChat: "删除全部对话",
    dataHelp: "这些操作会直接影响本地数据，且无法撤销。",
    save: "保存",
    saved: "已保存",
    saving: "保存中",
    unsaved: "未保存",
    cancel: "取消",
    close: "关闭",
  },
} as const;

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

type DropdownOption = {
  value: string;
  label: string;
};

function DropdownSelect({
  value,
  options,
  direction = "down",
  onChange,
}: {
  value: string;
  options: readonly DropdownOption[] | DropdownOption[];
  direction?: "up" | "down";
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const selectedLabel = options.find((opt) => opt.value === value)?.label || value;

  return (
    <div className={`dropdown-select-root ${open ? "open" : ""}`} ref={root}>
      <button
        type="button"
        className="dropdown-select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="dropdown-chevron" size={10} aria-hidden />
      </button>

      {open && (
        <div
          className={`dropdown-select-popover ${direction === "up" ? "open-up" : "open-down"}`}
          role="listbox"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`dropdown-select-item ${isSelected ? "selected" : ""}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected && <span className="dropdown-item-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NumberStepper({
  value,
  min = 13,
  max = 16,
  onChange,
}: {
  value: number | string;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
}) {
  const current =
    typeof value === "number"
      ? value
      : value === "small"
        ? 13
        : value === "medium"
          ? 15
          : value === "large"
            ? 16
            : parseInt(String(value), 10) || 13;
  const clamped = Math.max(min, Math.min(max, current));

  const inc = () => {
    if (clamped < max) onChange(clamped + 1);
  };
  const dec = () => {
    if (clamped > min) onChange(clamped - 1);
  };

  return (
    <div className="number-stepper">
      <span className="stepper-value">{clamped}</span>
      <div className="stepper-controls">
        <button
          type="button"
          className="stepper-btn stepper-up"
          onClick={inc}
          disabled={clamped >= max}
          tabIndex={-1}
          aria-label="Increase font size"
        >
          <ChevronUp size={8} aria-hidden />
        </button>
        <button
          type="button"
          className="stepper-btn stepper-down"
          onClick={dec}
          disabled={clamped <= min}
          tabIndex={-1}
          aria-label="Decrease font size"
        >
          <ChevronDown size={8} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel(props: Props) {
  const s = props.settings;
  const api = useMyChatApiContext();
  const [page, setPage] = useState<Page>(props.initialPage ?? "general");
  const [chatInstructions, setChatInstructions] = useState(s.chatInstructions);
  const [rule, setRule] = useState(s.systemPrompt);
  const [ruleEditable, setRuleEditable] = useState(false);
  const [saving, setSaving] = useState<Action | null>(null);
  const [saved, setSaved] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [newTavilyKey, setNewTavilyKey] = useState({ name: "", key: "" });
  const [newLlamaKey, setNewLlamaKey] = useState({ name: "", key: "" });
  const [firecrawlDraft, setFirecrawlDraft] = useState({
    url: s.firecrawlUrl,
    key: s.firecrawlApiKey,
  });
  const [adding, setAdding] = useState<"tavily" | "llamakey" | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmark, setBenchmark] = useState<ModelBenchmarkResult | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [llamaStatus, setLlamaStatus] = useState<LlamaStatus | null>(null);
  const [serviceAction, setServiceAction] = useState<"start" | "stop" | "restart" | null>(null);
  const [showLlamaModal, setShowLlamaModal] = useState(false);
  const [showTavilyModal, setShowTavilyModal] = useState(false);
  const [showLlamaKeyModal, setShowLlamaKeyModal] = useState(false);
  const [showFirecrawlModal, setShowFirecrawlModal] = useState(false);
  const t = COPY[s?.language === "zh" ? "zh" : "en"] || COPY.en;
  const isZh = s?.language === "zh";
  const activeReasoningEfforts =
    s.llamaModels.find((model) => model.name === s.model)?.reasoningEfforts ??
    detectReasoningEfforts(s.model);

  useEffect(() => setChatInstructions(s.chatInstructions), [s.chatInstructions]);
  useEffect(() => setRule(s.systemPrompt), [s.systemPrompt]);
  useEffect(
    () => setFirecrawlDraft({ url: s.firecrawlUrl, key: s.firecrawlApiKey }),
    [s.firecrawlUrl, s.firecrawlApiKey],
  );
  useEffect(() => {
    setBenchmark(null);
    setBenchmarkError("");
  }, [s.model]);
  useEffect(() => {
    if (page !== "general") return;
    void api.models
      .status()
      .then(setLlamaStatus)
      .catch(() => setLlamaStatus(null));
  }, [page, s.llamaUrl]);

  const dirty = useMemo(
    () => chatInstructions !== s.chatInstructions || (ruleEditable && rule !== s.systemPrompt),
    [chatInstructions, rule, ruleEditable, s],
  );

  const run = async (action: Action, operation: () => Promise<unknown>): Promise<boolean> => {
    setSaving(action);
    setSaved(null);
    setError("");
    try {
      const completed = await operation();
      if (completed === false) return false;
      setSaved(action);
      window.setTimeout(() => setSaved((current) => (current === action ? null : current)), 1800);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(null);
    }
  };

  const patch = (value: Partial<Settings>) => run("setting", () => props.onChange(value));
  const requestClose = () => {
    if (
      dirty &&
      !window.confirm(isZh ? "放弃未保存的设置更改？" : "Discard unsaved settings changes?")
    )
      return;
    props.onClose();
  };
  useEffect(() => {
    const onEscape = () => requestClose();
    window.addEventListener("mychat:settings-escape", onEscape);
    return () => window.removeEventListener("mychat:settings-escape", onEscape);
  }, [dirty, isZh, props.onClose]);

  const deleteModel = async (id: string) => {
    const remaining = s.llamaModels.filter((model) => model.id !== id);
    const deleting = s.llamaModels.find((model) => model.id === id);
    const activeEndpoint = s.llamaEndpoints.find((endpoint) => endpoint.url === s.llamaUrl);
    const replacement =
      remaining.find((model) => model.endpointId === activeEndpoint?.id) || remaining[0];
    await patch({
      llamaModels: remaining,
      ...(deleting?.name === s.model && replacement ? { model: replacement.name } : {}),
    });
  };

  const refreshModels = async () => {
    if (!props.onRefreshModels || refreshingModels) return;
    setRefreshingModels(true);
    setError("");
    try {
      await props.onRefreshModels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshingModels(false);
    }
  };

  const benchmarkModel = async () => {
    if (benchmarking || !s.model) return;
    setBenchmarking(true);
    setBenchmarkError("");
    try {
      setBenchmark(await api.models.benchmark(s.model));
    } catch (cause) {
      setBenchmark(null);
      setBenchmarkError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBenchmarking(false);
    }
  };

  const controlModelService = async (action: "start" | "stop" | "restart") => {
    if (serviceAction) return;
    setServiceAction(action);
    setError("");
    try {
      const status =
        action === "stop"
          ? await api.models.stop()
          : action === "restart"
            ? await api.models.reconnect()
            : await api.models.ensure();
      setLlamaStatus(status);
      if (status.port && status.port !== s.llamaPort)
        await props.onChange({ llamaPort: status.port });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setServiceAction(null);
    }
  };

  const addTavilyKey = async () => {
    if (!newTavilyKey.key.trim()) return;
    const item = {
      id: crypto.randomUUID(),
      name: newTavilyKey.name.trim() || `Key ${(s.tavilyApiKeys || []).length + 1}`,
      key: newTavilyKey.key.trim(),
    };
    if (
      await patch({
        tavilyApiKeys: [...(s.tavilyApiKeys || []), item],
        tavilyApiKey: item.key,
      })
    ) {
      setNewTavilyKey({ name: "", key: "" });
      setAdding(null);
    }
  };

  const deleteTavilyKey = async (id: string) => {
    const remaining = (s.tavilyApiKeys || []).filter((k) => k.id !== id);
    const deletingItem = (s.tavilyApiKeys || []).find((k) => k.id === id);
    const nextActive =
      s.tavilyApiKey === deletingItem?.key ? remaining[0]?.key || "" : s.tavilyApiKey;
    await patch({
      tavilyApiKeys: remaining,
      tavilyApiKey: nextActive,
    });
  };

  const addLlamaKey = async () => {
    if (!newLlamaKey.key.trim()) return;
    const item = {
      id: crypto.randomUUID(),
      name: newLlamaKey.name.trim() || `Key ${(s.llamaApiKeys || []).length + 1}`,
      key: newLlamaKey.key.trim(),
    };
    if (
      await patch({
        llamaApiKeys: [...(s.llamaApiKeys || []), item],
        llamaApiKey: item.key,
      })
    ) {
      setNewLlamaKey({ name: "", key: "" });
      setAdding(null);
    }
  };

  const deleteLlamaKey = async (id: string) => {
    const remaining = (s.llamaApiKeys || []).filter((k) => k.id !== id);
    const deletingItem = (s.llamaApiKeys || []).find((k) => k.id === id);
    const nextActive =
      s.llamaApiKey === deletingItem?.key ? remaining[0]?.key || "" : s.llamaApiKey;
    await patch({
      llamaApiKeys: remaining,
      llamaApiKey: nextActive,
    });
  };

  const nav: Array<{ id: Page; label: string }> = [
    { id: "general", label: t.general },
    { id: "models", label: t.models },
    { id: "research", label: t.webResearch },
    { id: "apikeys", label: t.apiKeys },
    { id: "instructions", label: t.instructions },
    { id: "data", label: t.data },
  ];

  return (
    <div className="settings-stage">
      <section className="settings-shell" aria-label={t.settings}>
        <aside className="settings-nav">
          <button
            className="settings-back"
            type="button"
            onClick={requestClose}
            aria-label={t.back}
          >
            <span aria-hidden="true">←</span>
            {t.back}
          </button>
          <h2>{t.settings}</h2>
          <nav>
            {nav.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                type="button"
                onClick={() => setPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          <header>
            <h3>{nav.find((item) => item.id === page)?.label}</h3>
          </header>

          {page === "general" && (
            <div className="settings-page">
              <div className="setting-row model-service-row">
                <div>
                  <span className="setting-title-line">
                    <strong>{t.modelService}</strong>
                    <i className={`service-state ${llamaStatus?.online ? "online" : ""}`}>
                      {llamaStatus?.online ? t.running : t.stopped}
                    </i>
                  </span>
                  <small>
                    {llamaStatus?.online
                      ? `${llamaStatus.url}${llamaStatus.pid ? ` · PID ${llamaStatus.pid}` : ""}`
                      : t.modelServiceHelp}
                  </small>
                </div>
                <div className="service-actions">
                  <button
                    type="button"
                    disabled={serviceAction !== null || Boolean(llamaStatus?.online)}
                    onClick={() => void controlModelService("start")}
                  >
                    {serviceAction === "start" ? (isZh ? "启动中" : "Starting") : t.start}
                  </button>
                  <button
                    type="button"
                    disabled={serviceAction !== null || !llamaStatus?.online}
                    onClick={() => void controlModelService("restart")}
                  >
                    {serviceAction === "restart" ? (isZh ? "重启中" : "Restarting") : t.restart}
                  </button>
                  <button
                    type="button"
                    disabled={serviceAction !== null || !llamaStatus?.online}
                    onClick={() => void controlModelService("stop")}
                  >
                    {serviceAction === "stop" ? (isZh ? "停止中" : "Stopping") : t.stop}
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.autoStart}</strong>
                  <small>{t.modelServiceHelp}</small>
                </div>
                <button
                  className={`toggle ${s.llamaAutoStart ? "on" : ""}`}
                  type="button"
                  aria-label={t.autoStart}
                  aria-pressed={s.llamaAutoStart}
                  onClick={() => void patch({ llamaAutoStart: !s.llamaAutoStart })}
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.language}</strong>
                  <small>{t.languageHelp}</small>
                </div>
                <DropdownSelect
                  value={s.language}
                  direction="up"
                  options={[
                    { value: "en", label: "English" },
                    { value: "zh", label: "中文" },
                  ]}
                  onChange={(val) => void patch({ language: val as Language })}
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.fontSize}</strong>
                  <small>{t.fontHelp}</small>
                </div>
                <NumberStepper
                  value={s.fontSize}
                  min={11}
                  max={14}
                  onChange={(val) => void patch({ fontSize: val as Settings["fontSize"] })}
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.theme}</strong>
                </div>
                <DropdownSelect
                  value={s.theme}
                  direction="down"
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  onChange={(val) => void patch({ theme: val as Settings["theme"] })}
                />
              </div>
            </div>
          )}

          {page === "models" && (
            <div className="settings-page">
              <div className="setting-row">
                <div>
                  <strong>{t.llamaConfig}</strong>
                  <small>{t.llamaConfigHelp}</small>
                </div>
                <button
                  type="button"
                  className="icon-btn ghost-icon"
                  onClick={() => {
                    setShowLlamaModal(true);
                    setAdding(null);
                  }}
                  title={t.configure}
                  aria-label={t.llamaConfig}
                >
                  <IconGear size={16} />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.defaultEffort}</strong>
                  <small>{t.defaultEffortHelp}</small>
                </div>
                <DropdownSelect
                  value={s.defaultEffort}
                  direction="down"
                  options={[
                    { value: "low", label: t.low },
                    { value: "medium", label: t.mediumLabel },
                    { value: "high", label: t.high },
                    { value: "xhigh", label: t.xhigh },
                  ].filter(
                    (option) =>
                      !activeReasoningEfforts ||
                      activeReasoningEfforts.includes(option.value as Settings["defaultEffort"]),
                  )}
                  onChange={(val) =>
                    void patch({ defaultEffort: val as Settings["defaultEffort"] })
                  }
                />
              </div>
            </div>
          )}

          {page === "research" && (
            <div className="settings-page">
              <div className="setting-row">
                <div>
                  <strong>{t.pageExtractor}</strong>
                </div>
                <DropdownSelect
                  value={s.researchExtractor}
                  direction="down"
                  options={[
                    { value: "tavily", label: t.cloud },
                    { value: "firecrawl", label: t.selfHosted },
                  ]}
                  onChange={(value) =>
                    void patch({ researchExtractor: value as Settings["researchExtractor"] })
                  }
                />
              </div>
              <div className="research-group-heading">{t.cloud}</div>
              <div className="setting-row">
                <div>
                  <strong>{t.extractDepth}</strong>
                  <small>{t.extractDepthHelp}</small>
                </div>
                <DropdownSelect
                  value={s.tavilyExtractDepth}
                  direction="down"
                  options={[
                    { value: "basic", label: t.basic },
                    { value: "advanced", label: t.advanced },
                  ]}
                  onChange={(value) =>
                    void patch({ tavilyExtractDepth: value as Settings["tavilyExtractDepth"] })
                  }
                />
              </div>
              <div className="research-group-heading">{t.selfHosted}</div>
              <div className="setting-row">
                <div>
                  <strong>{t.firecrawlTitle}</strong>
                  <small>{s.firecrawlUrl}</small>
                </div>
                <button
                  type="button"
                  className="icon-btn ghost-icon"
                  onClick={() => {
                    setFirecrawlDraft({ url: s.firecrawlUrl, key: s.firecrawlApiKey });
                    setShowFirecrawlModal(true);
                  }}
                  title={t.firecrawlConfigure}
                  aria-label={t.firecrawlConfigure}
                >
                  <IconGear size={16} />
                </button>
              </div>
            </div>
          )}

          {page === "apikeys" && (
            <div className="settings-page">
              <div className="setting-row">
                <div>
                  <strong>{t.tavilyTitle}</strong>
                  {s.tavilyApiKey && <small>Active: {maskApiKey(s.tavilyApiKey)}</small>}
                </div>
                <button
                  type="button"
                  className="icon-btn ghost-icon"
                  onClick={() => {
                    setShowTavilyModal(true);
                    setAdding(null);
                  }}
                  title={t.tavilyKeys}
                  aria-label={t.tavilyKeys}
                >
                  <IconGear size={16} />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t.llamaKeyTitle}</strong>
                  <small>
                    {s.llamaApiKey ? `Active: ${maskApiKey(s.llamaApiKey)}` : t.llamaKeyHelp}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-btn ghost-icon"
                  onClick={() => {
                    setShowLlamaKeyModal(true);
                    setAdding(null);
                  }}
                  title={t.llamaKeys}
                  aria-label={t.llamaKeys}
                >
                  <IconGear size={16} />
                </button>
              </div>
            </div>
          )}

          {page === "instructions" && (
            <div className="settings-page">
              <div className="page-intro">
                <h4>{t.custom}</h4>
                <p>{t.customHelp}</p>
              </div>
              <label className="field prompt">
                <span>{t.chatCustom}</span>
                <textarea
                  value={chatInstructions}
                  onChange={(e) => {
                    setChatInstructions(e.target.value);
                    setSaved(null);
                  }}
                  placeholder={t.addCustomInstructions}
                />
                <span className="field-action-row">
                  <small>
                    {saved === "chat"
                      ? t.saved
                      : chatInstructions !== s.chatInstructions
                        ? t.unsaved
                        : ""}
                  </small>
                  <button
                    className="settings-save"
                    type="button"
                    disabled={saving !== null || chatInstructions === s.chatInstructions}
                    onClick={() => void run("chat", () => props.onChange({ chatInstructions }))}
                  >
                    {saving === "chat" ? t.saving : t.save}
                  </button>
                </span>
              </label>
              <label className={`field prompt rule-field ${ruleEditable ? "editing" : "locked"}`}>
                <span className="rule-label-row">
                  <span>{t.rule}</span>
                  {!ruleEditable ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        window.confirm(
                          isZh
                            ? "修改此规则会改变模型语气与输出风格。继续？"
                            : "Changing this rule alters the model's voice and output style. Continue?",
                        ) && setRuleEditable(true)
                      }
                    >
                      {t.modify}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        if (
                          rule === s.systemPrompt ||
                          window.confirm(isZh ? "放弃更改并锁定？" : "Discard changes and lock?")
                        ) {
                          setRule(s.systemPrompt);
                          setRuleEditable(false);
                        }
                      }}
                    >
                      {t.lock}
                    </button>
                  )}
                </span>
                <div className="locked-rule-wrap">
                  <textarea
                    value={rule}
                    readOnly={!ruleEditable}
                    onChange={(e) => {
                      setRule(e.target.value);
                      setSaved(null);
                    }}
                    tabIndex={ruleEditable ? 0 : -1}
                  />
                  {!ruleEditable && (
                    <div className="rule-lock-note">
                      <span>{t.protected}</span>
                      <small>{t.protectedHelp}</small>
                    </div>
                  )}
                </div>
                {ruleEditable && (
                  <span className="field-action-row">
                    <small>
                      {saved === "rule" ? t.saved : rule !== s.systemPrompt ? t.unsaved : ""}
                    </small>
                    <button
                      className="settings-save"
                      type="button"
                      disabled={saving !== null || rule === s.systemPrompt}
                      onClick={() =>
                        void run("rule", () => props.onChange({ systemPrompt: rule })).then(
                          (ok) => ok && setRuleEditable(false),
                        )
                      }
                    >
                      {saving === "rule" ? t.saving : t.save}
                    </button>
                  </span>
                )}
              </label>
            </div>
          )}

          {page === "data" && (
            <div className="settings-page">
              <div className="setting-row">
                <div>
                  <strong>{t.memory}</strong>
                  <small>{t.memoryHelp}</small>
                </div>
                <button
                  className={`toggle ${s.memoryEnabled ? "on" : ""}`}
                  type="button"
                  aria-label={t.memory}
                  aria-pressed={s.memoryEnabled}
                  onClick={() => void patch({ memoryEnabled: !s.memoryEnabled })}
                >
                  <i />
                </button>
              </div>
              <div className="danger-row">
                <span>{t.deleteMemory}</span>
                <button
                  className="icon-btn ghost-icon danger-icon"
                  type="button"
                  disabled={saving !== null}
                  aria-label={t.deleteMemory}
                  onClick={() => {
                    if (
                      window.confirm(
                        isZh
                          ? "删除全部记忆？该操作无法撤销。"
                          : "Delete all memories? This cannot be undone.",
                      )
                    ) {
                      void run("memory", async () => {
                        if (!props.onDeleteAllMemories)
                          throw new Error("Memory deletion is unavailable.");
                        await props.onDeleteAllMemories();
                      });
                    }
                  }}
                >
                  <IconTrash />
                </button>
              </div>
              <div className="danger-row">
                <span>{t.deleteChat}</span>
                <button
                  className="icon-btn ghost-icon danger-icon"
                  type="button"
                  disabled={saving !== null}
                  aria-label={t.deleteChat}
                  onClick={() => {
                    if (
                      window.confirm(
                        isZh
                          ? "删除全部对话？该操作无法撤销。"
                          : "Delete all chats? This cannot be undone.",
                      )
                    ) {
                      void run("chats", props.onDeleteAllChats);
                    }
                  }}
                >
                  <IconTrash />
                </button>
              </div>
              <p className="data-note">{t.dataHelp}</p>
            </div>
          )}
          {error && (
            <div className="settings-error" role="alert">
              {error}
            </div>
          )}
        </main>
      </section>

      {showLlamaModal && (
        <div
          className="llama-modal-backdrop"
          onClick={() => {
            setShowLlamaModal(false);
            setAdding(null);
          }}
        >
          <div
            className="llama-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.llamaConfig}
          >
            <div className="llama-modal-head">
              <h4>{t.llamaConfig}</h4>
              <button
                type="button"
                className="llama-modal-close"
                onClick={() => {
                  setShowLlamaModal(false);
                  setAdding(null);
                }}
                aria-label={t.close}
              >
                ✕
              </button>
            </div>
            <p className="llama-modal-desc">{t.llamaConfigHelp}</p>

            <div className="llama-endpoint-list">
              {s.llamaEndpoints.map((endpoint) => (
                <div className="llama-endpoint-row" key={endpoint.id}>
                  <div className="endpoint-info">
                    <div className="endpoint-title-wrap">
                      <strong>{endpoint.name}</strong>
                      {s.llamaUrl === endpoint.url && (
                        <span className="endpoint-active-pill">{t.active}</span>
                      )}
                    </div>
                    <small>{endpoint.url}</small>
                    {s.llamaUrl === endpoint.url && (
                      <div className="endpoint-detected-model">
                        <span>
                          Model: <strong>{s.model}</strong>
                        </span>
                        <span className="reasoning-badge">
                          {
                            reasoningControlLabel(
                              s.llamaModels.find(
                                (model) =>
                                  model.name === s.model && model.endpointId === endpoint.id,
                              )?.reasoningControl ?? detectReasoningControl(s.model),
                              s.language,
                            ).label
                          }
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="endpoint-actions">
                    {s.llamaUrl !== endpoint.url && (
                      <button
                        type="button"
                        className="endpoint-use-btn"
                        onClick={() => {
                          const firstModel = s.llamaModels.find(
                            (model) => model.endpointId === endpoint.id,
                          );
                          void patch({
                            llamaUrl: endpoint.url,
                            ...(firstModel ? { model: firstModel.name } : {}),
                          });
                        }}
                      >
                        {t.use}
                      </button>
                    )}
                    <button
                      type="button"
                      className="endpoint-del-btn"
                      aria-label={`Delete ${endpoint.name}`}
                      disabled={s.llamaUrl === endpoint.url || s.llamaEndpoints.length === 1}
                      onClick={() =>
                        void patch({
                          llamaEndpoints: s.llamaEndpoints.filter(
                            (item) => item.id !== endpoint.id,
                          ),
                          llamaModels: s.llamaModels.filter(
                            (model) => model.endpointId !== endpoint.id,
                          ),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="llama-model-heading">
              <h5>{s.language === "zh" ? "本地模型" : "Local Model"}</h5>
              <button
                type="button"
                className={`model-speedometer${benchmark ? " has-result" : ""}${benchmarking ? " is-running" : ""}`}
                disabled={benchmarking || !s.model}
                onClick={() => void benchmarkModel()}
                title={
                  benchmark
                    ? `${benchmark.model} · ${benchmark.tokens} tokens · ${benchmark.durationMs} ms · ${benchmark.source}`
                    : t.testSpeed
                }
                aria-label={`${t.testSpeed}: ${s.model}`}
              >
                <IconGauge size={13} />
                <span>
                  {benchmarking
                    ? t.testingSpeed
                    : benchmark
                      ? `${benchmark.tokensPerSecond.toFixed(1)} t/s`
                      : t.testSpeed}
                </span>
              </button>
            </div>

            {benchmarkError && (
              <div className="settings-error" role="alert">
                {benchmarkError}
              </div>
            )}

            <div className="llama-endpoint-list llama-model-list">
              {s.llamaModels.map((model) => {
                const endpoint = s.llamaEndpoints.find((item) => item.id === model.endpointId);
                const isActive =
                  s.model === model.name && (!endpoint || s.llamaUrl === endpoint.url);
                return (
                  <div className="llama-endpoint-row model-config-row" key={model.id}>
                    <div className="endpoint-info">
                      <div className="endpoint-title-wrap">
                        <strong>{model.name}</strong>
                        {isActive && <span className="endpoint-active-pill">{t.active}</span>}
                      </div>
                    </div>
                    <div className="endpoint-actions">
                      {!isActive && endpoint && (
                        <button
                          type="button"
                          className="endpoint-use-btn"
                          onClick={() => void patch({ model: model.name, llamaUrl: endpoint.url })}
                        >
                          {t.use}
                        </button>
                      )}
                      {model.source !== "local" && (
                        <button
                          type="button"
                          className="endpoint-del-btn"
                          aria-label={`Delete ${model.name}`}
                          disabled={isActive && s.llamaModels.length === 1}
                          onClick={() => void deleteModel(model.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="refresh-models-trigger"
              disabled={!props.onRefreshModels || refreshingModels}
              onClick={() => void refreshModels()}
            >
              <span>
                {refreshingModels ? "…" : "↻"} {t.refreshModels}
              </span>
            </button>
          </div>
        </div>
      )}

      {showTavilyModal && (
        <div
          className="llama-modal-backdrop"
          onClick={() => {
            setShowTavilyModal(false);
            setAdding(null);
          }}
        >
          <div
            className="llama-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.tavilyKeys}
          >
            <div className="llama-modal-head">
              <h4>{t.tavilyKeys}</h4>
              <button
                type="button"
                className="llama-modal-close"
                onClick={() => {
                  setShowTavilyModal(false);
                  setAdding(null);
                }}
                aria-label={t.close}
              >
                ✕
              </button>
            </div>
            <p className="llama-modal-desc">{t.tavilyKeysHelp}</p>

            <div className="llama-endpoint-list">
              {(s.tavilyApiKeys || []).map((item) => (
                <div className="llama-endpoint-row" key={item.id}>
                  <div className="endpoint-info">
                    <div className="endpoint-title-wrap">
                      <strong>{item.name}</strong>
                      {s.tavilyApiKey === item.key && (
                        <span className="endpoint-active-pill">{t.active}</span>
                      )}
                    </div>
                    <small>{maskApiKey(item.key)}</small>
                  </div>
                  <div className="endpoint-actions">
                    {s.tavilyApiKey !== item.key && (
                      <button
                        type="button"
                        className="endpoint-use-btn"
                        onClick={() => void patch({ tavilyApiKey: item.key })}
                      >
                        {t.use}
                      </button>
                    )}
                    <button
                      type="button"
                      className="endpoint-del-btn"
                      aria-label={`Delete ${item.name}`}
                      disabled={(s.tavilyApiKeys || []).length <= 1 && s.tavilyApiKey === item.key}
                      onClick={() => void deleteTavilyKey(item.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {(!s.tavilyApiKeys || s.tavilyApiKeys.length === 0) && (
                <div className="empty-tasks-hint">{t.noKey}</div>
              )}
            </div>

            {adding === "tavily" ? (
              <div className="inline-add llama-add-form">
                <input
                  autoFocus
                  placeholder={t.keyName}
                  value={newTavilyKey.name}
                  onChange={(e) => setNewTavilyKey((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  type="password"
                  placeholder="tvly-..."
                  value={newTavilyKey.key}
                  onChange={(e) => setNewTavilyKey((v) => ({ ...v, key: e.target.value }))}
                />
                <div className="inline-add-btns">
                  <button type="button" className="text-btn" onClick={() => setAdding(null)}>
                    {t.cancel}
                  </button>
                  <button type="button" className="primary-btn" onClick={() => void addTavilyKey()}>
                    {t.save}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="add-endpoint-trigger"
                onClick={() => setAdding("tavily")}
              >
                <span>＋ {t.addKey}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showFirecrawlModal && (
        <div className="llama-modal-backdrop" onClick={() => setShowFirecrawlModal(false)}>
          <div
            className="llama-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.firecrawlConfigure}
          >
            <div className="llama-modal-head">
              <h4>{t.firecrawlConfigure}</h4>
              <button
                type="button"
                className="llama-modal-close"
                onClick={() => setShowFirecrawlModal(false)}
                aria-label={t.close}
              >
                ✕
              </button>
            </div>
            <p className="llama-modal-desc">{t.firecrawlHelp}</p>
            <div className="inline-add llama-add-form firecrawl-form">
              <label className="field">
                <span>{t.firecrawlUrl}</span>
                <input
                  autoFocus
                  placeholder="http://127.0.0.1:3002"
                  value={firecrawlDraft.url}
                  onChange={(e) =>
                    setFirecrawlDraft((value) => ({ ...value, url: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>{t.firecrawlKey}</span>
                <input
                  type="password"
                  placeholder="fc-..."
                  value={firecrawlDraft.key}
                  onChange={(e) =>
                    setFirecrawlDraft((value) => ({ ...value, key: e.target.value }))
                  }
                />
              </label>
              <div className="inline-add-btns">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setShowFirecrawlModal(false)}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={!firecrawlDraft.url.trim()}
                  onClick={() =>
                    void patch({
                      firecrawlUrl: firecrawlDraft.url,
                      firecrawlApiKey: firecrawlDraft.key,
                    }).then((ok) => ok && setShowFirecrawlModal(false))
                  }
                >
                  {t.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLlamaKeyModal && (
        <div
          className="llama-modal-backdrop"
          onClick={() => {
            setShowLlamaKeyModal(false);
            setAdding(null);
          }}
        >
          <div
            className="llama-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.llamaKeys}
          >
            <div className="llama-modal-head">
              <h4>{t.llamaKeys}</h4>
              <button
                type="button"
                className="llama-modal-close"
                onClick={() => {
                  setShowLlamaKeyModal(false);
                  setAdding(null);
                }}
                aria-label={t.close}
              >
                ✕
              </button>
            </div>
            <p className="llama-modal-desc">{t.llamaKeysHelp}</p>

            <div className="llama-endpoint-list">
              {(s.llamaApiKeys || []).map((item) => (
                <div className="llama-endpoint-row" key={item.id}>
                  <div className="endpoint-info">
                    <div className="endpoint-title-wrap">
                      <strong>{item.name}</strong>
                      {s.llamaApiKey === item.key && (
                        <span className="endpoint-active-pill">{t.active}</span>
                      )}
                    </div>
                    <small>{maskApiKey(item.key)}</small>
                  </div>
                  <div className="endpoint-actions">
                    {s.llamaApiKey !== item.key && (
                      <button
                        type="button"
                        className="endpoint-use-btn"
                        onClick={() => void patch({ llamaApiKey: item.key })}
                      >
                        {t.use}
                      </button>
                    )}
                    <button
                      type="button"
                      className="endpoint-del-btn"
                      aria-label={`Delete ${item.name}`}
                      disabled={(s.llamaApiKeys || []).length <= 1 && s.llamaApiKey === item.key}
                      onClick={() => void deleteLlamaKey(item.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {(!s.llamaApiKeys || s.llamaApiKeys.length === 0) && (
                <div className="empty-tasks-hint">{t.noKey}</div>
              )}
            </div>

            {adding === "llamakey" ? (
              <div className="inline-add llama-add-form">
                <input
                  autoFocus
                  placeholder={t.keyName}
                  value={newLlamaKey.name}
                  onChange={(e) => setNewLlamaKey((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  type="password"
                  placeholder="Bearer token / API key..."
                  value={newLlamaKey.key}
                  onChange={(e) => setNewLlamaKey((v) => ({ ...v, key: e.target.value }))}
                />
                <div className="inline-add-btns">
                  <button type="button" className="text-btn" onClick={() => setAdding(null)}>
                    {t.cancel}
                  </button>
                  <button type="button" className="primary-btn" onClick={() => void addLlamaKey()}>
                    {t.save}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="add-endpoint-trigger"
                onClick={() => setAdding("llamakey")}
              >
                <span>＋ {t.addKey}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
