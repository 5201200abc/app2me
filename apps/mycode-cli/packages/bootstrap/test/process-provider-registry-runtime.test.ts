import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startProcessProviderRegistryRuntime } from "../src/app/process-provider-registry-runtime.js";

test("独立 CLI 只读取打包 Built-in，并拒绝旧账号 Overlay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycode-provider-registry-"));
  const bundledFile = fileURLToPath(
    new URL("../../../../../config/provider/mycode-builtin.json", import.meta.url),
  );
  const staleFile = join(directory, "old-official-cache.json");
  await writeFile(staleFile, "invalid old cache", "utf8");
  const runtime = await startProcessProviderRegistryRuntime(
    {
      MYCODE_BUILTIN_PROVIDER_CONFIG_FILE: staleFile,
      MYCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE: bundledFile,
      MYCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(directory, "personal.json"),
    },
    { standalone: {} },
  );

  try {
    assert.equal(runtime.runtime.registryService.getSnapshot() !== null, true);
    const account = await runtime.accountSource.read();
    assert.equal(account.providers.keys().length, 0);
    await assert.rejects(runtime.syncAccountProviderConfig(account), /已退役/);
  } finally {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
