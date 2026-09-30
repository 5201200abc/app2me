import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAiSdkModelExecutionConfig } from "../src/model-config.js";

test("通用模型请求不携带旧官方 Referer 和 GLM 身份头", () => {
  const config = createRuntimeAiSdkModelExecutionConfig({});
  assert.equal(config.defaultHeaders?.["HTTP-Referer"], undefined);
  assert.equal(config.defaultHeaders?.["X-MyCode-Agent"], undefined);
  assert.match(config.defaultHeaders?.["User-Agent"] ?? "", /^MyCode\//u);
});
