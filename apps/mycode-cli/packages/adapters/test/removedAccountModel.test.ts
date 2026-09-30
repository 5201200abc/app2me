import assert from "node:assert/strict";
import { test } from "node:test";
import { AiSdkModelAdapter, type CreateAiSdkModelOptions } from "../src/model/runner.js";

test("历史账号与 Coding Plan API Key 模型不能进入执行适配器", () => {
  const adapter = new AiSdkModelAdapter({});
  for (const type of ["zhipu-account", "zhipu-coding-plan-api-key"] as const) {
    assert.throws(
      () =>
        adapter.createModel({
          providerId: "old-account",
          modelId: "old-model",
          providerConfig: {
            access: { type },
          } as CreateAiSdkModelOptions["providerConfig"],
          modelConfig: {} as CreateAiSdkModelOptions["modelConfig"],
        }),
      /account models have been removed/,
    );
  }
});
