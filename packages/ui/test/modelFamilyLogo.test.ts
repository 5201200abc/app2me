import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelFamilyLogo } from "../src/lib/modelFamilyLogo.js";

test("模型家族优先于中转服务商图案", () => {
  const relay = { type: "builtin", key: "openrouter" } as const;
  assert.deepEqual(resolveModelFamilyLogo("DeepSeek-V4.1-Flash", relay), {
    type: "builtin",
    key: "deepseek",
  });
  assert.deepEqual(resolveModelFamilyLogo("local/Qwen3.8-27B-Q4_K_M.gguf", relay), {
    type: "builtin",
    key: "qwen",
  });
  assert.deepEqual(resolveModelFamilyLogo("claude-opus", relay), {
    type: "builtin",
    key: "anthropic",
  });
});

test("未知模型保留目录图案，无图案时交给中性图标", () => {
  const logo = { type: "builtin", key: "openrouter" } as const;
  assert.equal(resolveModelFamilyLogo("custom-model", logo), logo);
  assert.equal(resolveModelFamilyLogo("custom-model", undefined), undefined);
});
