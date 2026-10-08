/* oxlint-disable eslint(max-lines) -- MyChat 功能单元保留完整结构。 */
import { readSetting, writeSetting, transaction } from "./db.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  Effort,
  Language,
  LlamaModel,
  ResearchExtractor,
  Settings,
  MyChatBusinessSettingsPatch,
} from "@mycode/shared/mychat";
import { detectReasoningControl, detectReasoningEfforts } from "@mycode/shared/mychat";
import { decryptLocalSecret, encryptLocalSecret } from "./local-secret.js";

const DEFAULT_MODELS_DIR = join(homedir(), "models");
const LOCAL_ENV = join(DEFAULT_MODELS_DIR, "websearch", ".env");
export const SYSTEM_PROMPT_PATH = join(homedir(), ".config", "llama", "LLAMA.md");

type Disk = {
  llamaUrl: string;
  llamaPort: number;
  llamaAutoStart: boolean;
  llamaApiKeyEnc: string;
  llamaApiKeysEnc: string;
  model: string;
  tavilyApiKeyEnc: string;
  tavilyApiKeysEnc: string;
  firecrawlUrl: string;
  firecrawlApiKeyEnc: string;
  researchExtractor: ResearchExtractor;
  tavilyExtractDepth: "basic" | "advanced";
  defaultEffort: Effort | "light";
  memoryEnabled: boolean;
  modelsDir: string;
  chatInstructions: string;
  language: Language;
  modelCatalog: string[];
  llamaModels: LlamaModel[];
  llamaEndpoints: Array<{ id: string; name: string; url: string }>;
};

const defaults: Disk = {
  llamaUrl: "http://127.0.0.1/v1",
  llamaPort: 0,
  llamaAutoStart: true,
  llamaApiKeyEnc: "",
  llamaApiKeysEnc: "",
  model: "Qwen3.8-27B",
  tavilyApiKeyEnc: "",
  tavilyApiKeysEnc: "",
  firecrawlUrl: "http://127.0.0.1:3002",
  firecrawlApiKeyEnc: "",
  researchExtractor: "tavily",
  tavilyExtractDepth: "advanced",
  defaultEffort: "xhigh",
  memoryEnabled: true,
  modelsDir: DEFAULT_MODELS_DIR,
  chatInstructions: "",
  language: "en",
  modelCatalog: ["Qwen3.8-27B"],
  llamaModels: [],
  llamaEndpoints: [{ id: "local", name: "Current model", url: "http://127.0.0.1/v1" }],
};
const store = {
  get<K extends keyof Disk>(key: K): Disk[K] {
    return readSetting(key, defaults[key]);
  },
  set<K extends keyof Disk>(key: K, value: Disk[K]): void {
    writeSetting(key, value);
  },
};
let systemPrompt = "";
export async function initializeSettings(): Promise<void> {
  systemPrompt = await readFile(SYSTEM_PROMPT_PATH, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const text = await readFile(LOCAL_ENV, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const key = text.match(/^\s*TAVILY_API_KEY\s*=\s*(.+)\s*$/m)?.[1]?.trim();
  if (key && !decryptLocalSecret(store.get("tavilyApiKeyEnc")))
    store.set("tavilyApiKeyEnc", encryptLocalSecret(key));
}

function localLlamaUrl(port: number): string {
  return port > 0 ? `http://127.0.0.1:${port}/v1` : "http://127.0.0.1/v1";
}

function portFromUrl(value: string): number {
  try {
    const parsed = new URL(value);
    if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) return 0;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
  } catch {
    return 0;
  }
}

export function setDetectedLlamaPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  const url = localLlamaUrl(port);
  store.set("llamaPort", port);
  store.set("llamaUrl", url);
  const endpoints = store.get("llamaEndpoints") || [];
  const local = endpoints.find((endpoint) => endpoint.id === "local");
  store.set("llamaEndpoints", [
    { id: "local", name: "Current model", url },
    ...endpoints.filter((endpoint) => endpoint.id !== "local" && endpoint.id !== local?.id),
  ]);
}

export function readSystemPrompt(): string {
  return systemPrompt;
}
export async function writeSystemPrompt(text: string): Promise<void> {
  await mkdir(dirname(SYSTEM_PROMPT_PATH), { recursive: true });
  await writeFile(SYSTEM_PROMPT_PATH, text, "utf8");
  systemPrompt = text;
}

function normalizeEffort(value: string | undefined): Effort {
  if (value === "low" || value === "light") return "low";
  if (["none", "minimal", "medium", "high", "xhigh", "max"].includes(value || "")) {
    return value as Effort;
  }
  return "medium";
}

export function getSettings(): Settings {
  const rawPort = store.get("llamaPort");
  const storedPort = Number.isInteger(rawPort) ? Number(rawPort) : 0;
  const rawUrl = store.get("llamaUrl") || "http://127.0.0.1/v1";
  const urlPort = portFromUrl(rawUrl);
  const activeUrl =
    storedPort > 0 ? localLlamaUrl(storedPort) : urlPort > 0 ? localLlamaUrl(urlPort) : rawUrl;

  const endpoints = store.get("llamaEndpoints") || [];
  const normalizedEndpoints = (
    endpoints.length > 0 ? endpoints : [{ id: "local", name: "Current model", url: activeUrl }]
  ).map((endpoint) =>
    endpoint.id === "local" ||
    /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/v1\/?$/i.test(endpoint.url)
      ? { ...endpoint, url: activeUrl }
      : endpoint,
  );

  const localEndpoint =
    normalizedEndpoints.find((endpoint) => endpoint.id === "local") ||
    normalizedEndpoints.find((endpoint) =>
      /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/v1\/?$/i.test(endpoint.url),
    ) ||
    normalizedEndpoints[0];

  const catalog = store.get("modelCatalog") || ["Qwen3.8-27B"];
  const configuredModels = store.get("llamaModels") || [];
  const llamaModels =
    configuredModels.length > 0
      ? configuredModels
      : catalog.map((name) => ({
          id: `local:${name}`,
          name,
          endpointId: localEndpoint?.id || "local",
          reasoningControl: detectReasoningControl(name),
          reasoningEfforts: detectReasoningEfforts(name),
          source: "local" as const,
        }));

  const activeTavilyKey = decryptLocalSecret(store.get("tavilyApiKeyEnc"));
  const activeLlamaKey = decryptLocalSecret(store.get("llamaApiKeyEnc"));

  let tavilyApiKeys: Settings["tavilyApiKeys"] = [];
  try {
    const raw = decryptLocalSecret(store.get("tavilyApiKeysEnc"));
    if (raw) tavilyApiKeys = JSON.parse(raw);
  } catch {}
  if (activeTavilyKey && !tavilyApiKeys.some((k) => k.key === activeTavilyKey)) {
    tavilyApiKeys = [
      { id: "default-tavily", name: "Default Key", key: activeTavilyKey },
      ...tavilyApiKeys,
    ];
  }

  let llamaApiKeys: Settings["llamaApiKeys"] = [];
  try {
    const raw = decryptLocalSecret(store.get("llamaApiKeysEnc"));
    if (raw) llamaApiKeys = JSON.parse(raw);
  } catch {}
  if (activeLlamaKey && !llamaApiKeys.some((k) => k.key === activeLlamaKey)) {
    llamaApiKeys = [
      { id: "default-llama", name: "Default Key", key: activeLlamaKey },
      ...llamaApiKeys,
    ];
  }

  return {
    llamaUrl: activeUrl,
    llamaPort: storedPort,
    llamaAutoStart: store.get("llamaAutoStart"),
    llamaApiKey: activeLlamaKey,
    model: store.get("model"),
    tavilyApiKey: activeTavilyKey,
    firecrawlUrl: store.get("firecrawlUrl") || "http://127.0.0.1:3002",
    firecrawlApiKey: decryptLocalSecret(store.get("firecrawlApiKeyEnc")),
    researchExtractor: store.get("researchExtractor") || "tavily",
    tavilyExtractDepth: store.get("tavilyExtractDepth") || "advanced",
    defaultEffort: normalizeEffort(store.get("defaultEffort")),
    memoryEnabled: store.get("memoryEnabled"),
    theme: "system", // 展示占位值由 hook 注入宿主主题，不持久化第二份偏好。
    modelsDir: store.get("modelsDir") || DEFAULT_MODELS_DIR,
    systemPrompt: readSystemPrompt(),
    systemPromptPath: SYSTEM_PROMPT_PATH,
    chatInstructions: store.get("chatInstructions"),
    language: store.get("language") || "en",
    fontSize: 14,
    modelCatalog: catalog,
    llamaModels,
    llamaEndpoints: normalizedEndpoints,
    tavilyApiKeys,
    llamaApiKeys,
  };
}

export async function setSettings(patch: MyChatBusinessSettingsPatch): Promise<Settings> {
  if (patch.llamaUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(patch.llamaUrl.trim());
    } catch {
      throw new Error("Llama API URL must be a valid http or https URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Llama API URL must use http or https.");
    }
  }
  if (
    patch.model !== undefined &&
    !patch.model.trim() &&
    (patch.llamaModels || getSettings().llamaModels).length > 0
  ) {
    throw new Error("Model cannot be empty while local models are configured.");
  }
  if (patch.model !== undefined && patch.model.length > 200) {
    throw new Error("Model name is too long.");
  }
  if (
    patch.llamaPort !== undefined &&
    (!Number.isInteger(patch.llamaPort) || patch.llamaPort < 0 || patch.llamaPort > 65535)
  ) {
    throw new Error("Llama port must be 0 (automatic) or between 1 and 65535.");
  }
  if (
    patch.researchExtractor !== undefined &&
    !["tavily", "firecrawl"].includes(patch.researchExtractor)
  ) {
    throw new Error("Web Research extractor must be Tavily or Firecrawl.");
  }
  if (
    patch.tavilyExtractDepth !== undefined &&
    !["basic", "advanced"].includes(patch.tavilyExtractDepth)
  ) {
    throw new Error("Tavily Extract depth must be basic or advanced.");
  }
  if (patch.firecrawlUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(patch.firecrawlUrl.trim());
    } catch {
      throw new Error("Firecrawl API URL must be a valid http or https URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Firecrawl API URL must use http or https.");
    }
    if (url.hostname === "api.firecrawl.dev") {
      throw new Error(
        "Web Research reserves Firecrawl for self-hosted endpoints; use Tavily for cloud extraction.",
      );
    }
  }
  if (patch.chatInstructions !== undefined && patch.chatInstructions.length > 20_000) {
    throw new Error("Chat custom instructions cannot exceed 20,000 characters.");
  }
  if (
    patch.defaultEffort !== undefined &&
    !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(patch.defaultEffort)
  ) {
    throw new Error("Invalid default reasoning effort.");
  }
  if (patch.language !== undefined && !["en", "zh"].includes(patch.language)) {
    throw new Error("Invalid language.");
  }
  if (patch.modelCatalog !== undefined) {
    if (!Array.isArray(patch.modelCatalog) || patch.modelCatalog.length > 5) {
      throw new Error("Model list must contain no more than 5 models.");
    }
    if (
      patch.modelCatalog.some(
        (model) => typeof model !== "string" || !model.trim() || model.length > 200,
      )
    ) {
      throw new Error("Every model must have a valid name.");
    }
  }
  if (patch.llamaModels !== undefined) {
    if (!Array.isArray(patch.llamaModels) || patch.llamaModels.length > 5) {
      throw new Error("Model list must contain no more than 5 models.");
    }
    const endpointIds = new Set(
      (patch.llamaEndpoints || getSettings().llamaEndpoints).map((endpoint) => endpoint.id),
    );
    for (const model of patch.llamaModels) {
      if (
        !model ||
        typeof model.id !== "string" ||
        typeof model.name !== "string" ||
        !model.name.trim() ||
        model.name.length > 200 ||
        !endpointIds.has(model.endpointId) ||
        !["effort", "toggle", "none"].includes(model.reasoningControl || "")
      ) {
        throw new Error("Every model must have a valid name, Llama server, and reasoning control.");
      }
    }
  }
  if (patch.llamaEndpoints !== undefined) {
    if (!Array.isArray(patch.llamaEndpoints) || patch.llamaEndpoints.length > 20) {
      throw new Error("Llama list must contain no more than 20 endpoints.");
    }
    for (const endpoint of patch.llamaEndpoints) {
      if (
        !endpoint ||
        typeof endpoint.id !== "string" ||
        typeof endpoint.name !== "string" ||
        typeof endpoint.url !== "string"
      ) {
        throw new Error("Every Llama endpoint must have an id, name, and URL.");
      }
      const url = new URL(endpoint.url.trim());
      if (!["http:", "https:"].includes(url.protocol) || !endpoint.name.trim()) {
        throw new Error("Every Llama endpoint must have a valid name and http or https URL.");
      }
    }
  }

  if (patch.tavilyApiKeys !== undefined) {
    if (!Array.isArray(patch.tavilyApiKeys) || patch.tavilyApiKeys.length > 50) {
      throw new Error("Tavily API list must contain no more than 50 entries.");
    }
    for (const item of patch.tavilyApiKeys) {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.key !== "string"
      ) {
        throw new Error("Every Tavily key must have an id, name, and key string.");
      }
    }
  }

  if (patch.llamaApiKeys !== undefined) {
    if (!Array.isArray(patch.llamaApiKeys) || patch.llamaApiKeys.length > 50) {
      throw new Error("Llama API key list must contain no more than 50 keys.");
    }
    for (const item of patch.llamaApiKeys) {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.key !== "string"
      ) {
        throw new Error("Every Llama key must have an id, name, and key string.");
      }
    }
  }

  if (patch.systemPrompt !== undefined) await writeSystemPrompt(patch.systemPrompt);
  transaction(() => {
    if (patch.llamaUrl !== undefined) store.set("llamaUrl", patch.llamaUrl.trim());
    if (patch.llamaPort !== undefined) {
      store.set("llamaPort", patch.llamaPort);
      store.set("llamaUrl", localLlamaUrl(patch.llamaPort));
    }
    if (patch.llamaAutoStart !== undefined) store.set("llamaAutoStart", patch.llamaAutoStart);
    if (patch.firecrawlUrl !== undefined)
      store.set("firecrawlUrl", patch.firecrawlUrl.trim().replace(/\/+$/, ""));
    if (patch.researchExtractor !== undefined)
      store.set("researchExtractor", patch.researchExtractor);
    if (patch.tavilyExtractDepth !== undefined)
      store.set("tavilyExtractDepth", patch.tavilyExtractDepth);
    if (patch.model !== undefined) store.set("model", patch.model.trim());
    if (patch.defaultEffort !== undefined)
      store.set("defaultEffort", normalizeEffort(patch.defaultEffort));
    if (patch.memoryEnabled !== undefined) store.set("memoryEnabled", patch.memoryEnabled);
    if (patch.language !== undefined) store.set("language", patch.language);
    if (patch.modelCatalog !== undefined)
      store.set("modelCatalog", [...new Set(patch.modelCatalog.map((model) => model.trim()))]);
    if (patch.llamaModels !== undefined) {
      store.set(
        "llamaModels",
        patch.llamaModels.map((model) => ({ ...model, name: model.name.trim() })),
      );
      store.set("modelCatalog", [...new Set(patch.llamaModels.map((model) => model.name.trim()))]);
    }
    if (patch.llamaEndpoints !== undefined) {
      store.set(
        "llamaEndpoints",
        patch.llamaEndpoints.map((endpoint) => ({
          id: endpoint.id,
          name: endpoint.name.trim(),
          url: endpoint.url.trim(),
        })),
      );
    }
    if (patch.tavilyApiKeys !== undefined) {
      const clean = patch.tavilyApiKeys.map((k) => ({
        id: k.id,
        name: k.name.trim() || "Tavily Key",
        key: k.key.trim(),
      }));
      store.set("tavilyApiKeysEnc", encryptLocalSecret(JSON.stringify(clean)));
      if (
        patch.tavilyApiKey === undefined &&
        clean.length > 0 &&
        !clean.some((k) => k.key === getSettings().tavilyApiKey)
      ) {
        store.set("tavilyApiKeyEnc", encryptLocalSecret(clean[0]?.key ?? ""));
      }
    }
    if (patch.llamaApiKeys !== undefined) {
      const clean = patch.llamaApiKeys.map((k) => ({
        id: k.id,
        name: k.name.trim() || "Llama Key",
        key: k.key.trim(),
      }));
      store.set("llamaApiKeysEnc", encryptLocalSecret(JSON.stringify(clean)));
      if (
        patch.llamaApiKey === undefined &&
        clean.length > 0 &&
        !clean.some((k) => k.key === getSettings().llamaApiKey)
      ) {
        store.set("llamaApiKeyEnc", encryptLocalSecret(clean[0]?.key ?? ""));
      }
    }
    if (patch.modelsDir !== undefined) store.set("modelsDir", patch.modelsDir.trim());
    if (patch.chatInstructions !== undefined) store.set("chatInstructions", patch.chatInstructions);
    if (patch.llamaApiKey !== undefined)
      store.set("llamaApiKeyEnc", encryptLocalSecret(patch.llamaApiKey.trim()));
    if (patch.tavilyApiKey !== undefined)
      store.set("tavilyApiKeyEnc", encryptLocalSecret(patch.tavilyApiKey.trim()));
    if (patch.firecrawlApiKey !== undefined)
      store.set("firecrawlApiKeyEnc", encryptLocalSecret(patch.firecrawlApiKey.trim()));
  });
  return getSettings();
}
