export const LOCAL_MODEL_PROVIDER_ID = "local-llama-models";
export const DEEPSEEK_TEMPLATE_ID = "deepseek";

export interface DiscoveredLocalModel {
  id: string;
  name: string;
  path: string;
  mmprojPath: string | null;
  sizeBytes: number;
  vision: boolean;
  reasoningControl: "effort" | "toggle";
  reasoningLevels: string[];
  defaultReasoningLevel: string;
  reasoningCelMap: string;
}

export interface LocalModelScanResult {
  modelsDir: string;
  directoryExists: boolean;
  models: DiscoveredLocalModel[];
  warnings: string[];
}

// 旧实现用 includes("qwen3")，把其他 Qwen 版本错误授予三档力度。
// 只识别官方 Qwen3.8-27B 身份及路径/量化后缀，不能把 270B 或其他版本混入。
export function isQwen38Model(name: string): boolean {
  return /(?:^|[\\/])qwen[-_]?3[._]8[-_]27b(?=$|[-_.])/i.test(name);
}

export function localModelReasoning(name: string): { values: string[]; map: string } {
  if (isQwen38Model(name)) {
    return {
      values: ["disabled", "low", "medium", "xhigh"],
      // 官方三档原样传输；llama.cpp 通过模板参数消费 effort，关闭时不发送任何 effort。
      map: 'reasoningLevel == "disabled" ? {"chat_template_kwargs": {"enable_thinking": false}} : {"reasoning_effort": reasoningLevel, "chat_template_kwargs": {"enable_thinking": true, "preserve_thinking": true, "reasoning_effort": reasoningLevel}}',
    };
  }
  return {
    values: ["disabled", "enabled"],
    map: '{"chat_template_kwargs": {"enable_thinking": reasoningLevel == "enabled"}}',
  };
}
