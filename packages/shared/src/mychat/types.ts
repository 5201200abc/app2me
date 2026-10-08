export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningControl = "effort" | "toggle" | "none";

export type LlamaModel = {
  id: string;
  name: string;
  endpointId: string;
  reasoningControl?: ReasoningControl;
  reasoningEfforts?: Effort[];
  source?: "local" | "remote";
};

export type LocalModel = {
  name: string;
  path?: string;
  mmproj?: string | null;
  size?: number;
  modified?: number;
  reasoningControl?: ReasoningControl;
  reasoningEfforts?: Effort[];
  vision?: boolean;
  architecture?: string;
  contextLength?: number;
  chatTemplate?: string;
  quantization?: string;
  parameters?: string;
};

export function detectReasoningEfforts(modelName: string, chatTemplate = ""): Effort[] | undefined {
  const haystack = `${modelName}\n${chatTemplate}`.toLowerCase();
  if (
    haystack.includes("qwen3.8") ||
    haystack.includes("qwen-3.8") ||
    haystack.includes("qwen_3.8") ||
    haystack.includes("qwen3_8") ||
    haystack.includes("qwen3") ||
    haystack.includes("qwen-3")
  ) {
    return ["none", "low", "medium", "xhigh"];
  }
  if (haystack.includes("gemma-4") || haystack.includes("gemma4")) {
    return ["none", "low", "medium", "high"];
  }
  if (
    haystack.includes("thought_budget") ||
    haystack.includes("reasoning_effort") ||
    haystack.includes("reasoning_budget") ||
    haystack.includes("thinking_budget")
  ) {
    if (haystack.includes("xhigh") || haystack.includes("extra_high")) {
      return ["none", "low", "medium", "high", "xhigh"];
    }
    return ["none", "low", "medium", "high"];
  }
  return undefined;
}

export function detectReasoningControl(modelName: string, chatTemplate = ""): ReasoningControl {
  const efforts = detectReasoningEfforts(modelName, chatTemplate);
  if (efforts && efforts.length > 0) return "effort";

  const haystack = `${modelName}\n${chatTemplate}`.toLowerCase();
  if (
    haystack.includes("deepseek-r1") ||
    haystack.includes("deepseek_r1") ||
    haystack.includes("qwq") ||
    haystack.includes("<think>") ||
    haystack.includes("enable_thinking") ||
    haystack.includes("thinking_mode")
  ) {
    return "toggle";
  }

  return "none";
}

export function normalizeReasoningEffort(
  requested: Effort | undefined,
  supported: Effort[] | undefined,
  fallback: Effort = "medium",
): Effort {
  if (!supported || supported.length === 0) return requested || fallback;
  if (requested && supported.includes(requested)) return requested;
  if (supported.includes(fallback)) return fallback;
  return supported[0] ?? fallback;
}

export function reasoningControlLabel(
  control: ReasoningControl,
  language: "en" | "zh" = "en",
  effort?: Effort,
): { label: string; tag: string; description: string } {
  const isZh = language === "zh";
  if (control === "effort") {
    const effortText = effort ? effort.toUpperCase() : "AUTO";
    return isZh
      ? { label: "深度思考力度", tag: effortText, description: "支持按需调整思考深度" }
      : { label: "Reasoning effort", tag: effortText, description: "Adjustable thinking budget" };
  }
  if (control === "toggle") {
    return isZh
      ? { label: "深度思考开关", tag: "Thinking ON", description: "支持开启或跳过思考过程" }
      : {
          label: "Reasoning toggle",
          tag: "Thinking ON",
          description: "Toggle thinking process on or off",
        };
  }
  return isZh
    ? { label: "标准模型", tag: "No thinking", description: "无深度思考控制" }
    : { label: "Standard model", tag: "No thinking", description: "No thinking control" };
}

export type Theme = "system" | "light" | "dark";
export type Language = "en" | "zh";
export type FontSize = 11 | 12 | 13 | 14 | 15 | 16 | "small" | "medium" | "large";
export type Role = "user" | "assistant" | "system";
export type ChatPhase = "preparing" | "searching" | "thinking" | "answering" | "done" | "error";

export type ApiKeyItem = {
  id: string;
  name: string;
  key: string;
};

export type ResearchExtractor = "tavily" | "firecrawl";

export type Settings = {
  llamaUrl: string;
  llamaPort: number;
  llamaAutoStart: boolean;
  llamaApiKey: string;
  model: string;
  tavilyApiKey: string;
  firecrawlUrl: string;
  firecrawlApiKey: string;
  researchExtractor: ResearchExtractor;
  tavilyExtractDepth: "basic" | "advanced";
  defaultEffort: Effort;
  memoryEnabled: boolean;
  theme: Theme;
  modelsDir: string;
  systemPrompt: string;
  systemPromptPath: string;
  chatInstructions: string;
  language: Language;
  fontSize: FontSize;
  modelCatalog: string[];
  llamaModels: LlamaModel[];
  llamaEndpoints: Array<{
    id: string;
    name: string;
    url: string;
  }>;
  tavilyApiKeys: ApiKeyItem[];
  llamaApiKeys: ApiKeyItem[];
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type Attachment = {
  id: string;
  mime: string;
  name: string;
  dataUrl?: string;
  frames?: string[];
  duration?: number;
  path?: string;
  relativePath?: string;
  size?: number;
  kind?: "image" | "video" | "audio" | "document" | "text" | "code" | "archive" | "pdf" | "file";
  text?: string;
};

export type ResearchSite = {
  title: string;
  url: string;
  domain: string;
};

export type ResearchStep = {
  id: string;
  kind: "search" | "read" | "verify";
  status: "active" | "done";
  count?: number;
  domains?: string[];
  sites?: ResearchSite[];
  detail?: string;
};

export type ResearchProgress = {
  strategy: string;
  steps: ResearchStep[];
  sources?: ResearchSite[];
  complete?: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  thinking: string;
  attachments: Attachment[];
  createdAt: number;
  phase?: ChatPhase;
  phaseStartedAt?: number;
  introText?: string;
  statusText?: string;
  research?: ResearchProgress;
  durationSeconds?: number;
};

export type MemoryItem = {
  id: string;
  content: string;
  sourceId: string;
  createdAt: number;
};

export type LlamaStatus = {
  online: boolean;
  port: number | null;
  pid: number | null;
  managed: boolean;
  model: string;
  vision: boolean;
  url: string;
  modelsDir: string;
  ggufs: string[];
  models: string[];
  localModels: LocalModel[];
  router: boolean;
  runningModel: string | null;
  runningModelPath: string | null;
  mmproj: string | null;
  error?: string;
};

export type ModelBenchmarkResult = {
  model: string;
  tokensPerSecond: number;
  tokens: number;
  durationMs: number;
  source: "llama.cpp" | "measured";
};

export type ChatSendPayload = {
  conversationId: string;
  content: string;
  attachments: Attachment[];
  effort: Effort;
  webSearch: boolean;
};

export type StreamDelta = {
  conversationId: string;
  messageId: string;
  thinking?: string;
  content?: string;
  phase?: ChatPhase;
  statusText?: string;
  research?: ResearchProgress;
};

export type StreamDone = {
  conversationId: string;
  messageId: string;
  thinking: string;
  content: string;
  stopped?: boolean;
  durationSeconds?: number;
  research?: ResearchProgress;
};
