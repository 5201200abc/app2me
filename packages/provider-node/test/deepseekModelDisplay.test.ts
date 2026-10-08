import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ApiKeyAccessConfig, ProviderConfig } from "@mycode/provider";
import { NodeProviderRegistryRuntime, createNodeModelSelectionFacade } from "../src/index.js";
import { buildRegistryModelSelectGroups } from "../../ui/src/lib/modelSelectionGroups.js";
import { decodeCustomModelValue } from "../../ui/src/lib/mycodeCustomModelValue.js";
import { resolveModelThoughtOption } from "../../ui/src/lib/modelThoughtOption.js";
import { resolveThoughtSlider } from "../../ui/src/chat-input-toolbar/thoughtSliderOptions.js";
import { listRegistryBackedModels } from "../../../apps/mycode-cli/packages/bootstrap/src/app/provider-registry-selection.js";
import { createModelCatalogPort } from "../../../apps/mycode-cli/packages/bootstrap/src/app/model-catalog-port.js";

test("DeepSeek display version and vision badge keep the canonical submitted model ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepseek-ui-"));
  const runtime = new NodeProviderRegistryRuntime({
    mycodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/mycode-builtin.json", import.meta.url),
    ),
    personalFilePath: join(root, "personal.json"),
    watch: false,
    personalPollingIntervalMs: false,
  });
  try {
    const created = await runtime.configService.createPersonalProvider({
      templateId: "deepseek",
      initialConfig: new ProviderConfig({
        access: new ApiKeyAccessConfig({ apiKey: "fixture-key" }),
      }),
    });
    await runtime.start();
    const groups = buildRegistryModelSelectGroups(
      "glm",
      createNodeModelSelectionFacade(runtime.registryService).getView(),
    );
    const flash = groups
      .flatMap((group) => group.items)
      .find((item) => item.name === "DeepSeek-V4.1-Flash")!;
    assert.ok(flash);
    assert.equal(flash.supportsVisionInput, true);
    assert.deepEqual(decodeCustomModelValue(flash.value), {
      providerId: created.providerId,
      modelName: "deepseek-flash",
    });
    const pro = groups
      .flatMap((group) => group.items)
      .find((item) => item.name === "DeepSeek-V4-Pro")!;
    assert.equal(pro.supportsVisionInput, undefined);
    const thought = resolveModelThoughtOption({
      modelSelectionView: createNodeModelSelectionFacade(runtime.registryService).getView(),
      providerId: created.providerId,
      modelId: "deepseek-flash",
      currentValue: "low",
    })!;
    assert.equal(thought.currentValue, "low");
    assert.equal(resolveThoughtSlider(thought).defaultValue, "high");
    assert.equal(
      resolveModelThoughtOption({
        modelSelectionView: createNodeModelSelectionFacade(runtime.registryService).getView(),
        providerId: created.providerId,
        modelId: "deepseek-flash",
      })?.currentValue,
      "",
    );
    const cliModel = listRegistryBackedModels(runtime.registryService).find(
      (model) => model.ref.modelId === "deepseek-flash",
    )!;
    assert.equal(cliModel.label, "DeepSeek-V4.1-Flash");
    assert.equal(cliModel.reasoning?.defaultLevel, "high");
    assert.equal(cliModel.contextWindow, 1_048_576);
    const catalog = createModelCatalogPort({
      registry: runtime.registryService,
      currentSelection: () => undefined,
    });
    assert.equal(
      catalog.listModels().find((model) => model.modelId === "deepseek-flash")
        ?.defaultReasoningLevel,
      "high",
    );
  } finally {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
