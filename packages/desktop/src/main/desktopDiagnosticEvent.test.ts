import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("retired telemetry remains local in development and adds no production payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "app2me-local-diagnostic-"));
  const saved = {
    mode: process.env.NODE_ENV,
    environment: process.env.MYCODE_ENV,
    logs: process.env.MYCODE_E2E_RUNTIME_LOG_DIR,
  };
  try {
    process.env.MYCODE_ENV = "test";
    process.env.MYCODE_E2E_RUNTIME_LOG_DIR = root;
    const { recordDesktopDiagnosticEvent } = await import("./desktopDiagnosticEvent.js");
    process.env.NODE_ENV = "development";
    recordDesktopDiagnosticEvent({ name: "development-fixture", measurements: { duration: 7 } });
    process.env.NODE_ENV = "production";
    recordDesktopDiagnosticEvent({ name: "production-fixture" });
    const text = (
      await Promise.all((await readdir(root)).map((file) => readFile(join(root, file), "utf8")))
    ).join("\n");
    assert.match(text, /development-fixture/);
    assert.doesNotMatch(text, /production-fixture/);
  } finally {
    for (const [key, value] of Object.entries({
      NODE_ENV: saved.mode,
      MYCODE_ENV: saved.environment,
      MYCODE_E2E_RUNTIME_LOG_DIR: saved.logs,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
