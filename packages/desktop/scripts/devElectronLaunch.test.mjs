import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  consumeDevLaunchEnvironment,
  createMacDevElectronLaunch,
  connectDevLaunchOwner,
} from "./devElectronLaunch.mjs";

test("LaunchServices gets private environment via file, preserves spaced paths and isolates shutdown", async () => {
  const logDirectory = await mkdtemp(join(tmpdir(), "mycode-launch-test-"));
  const env = {
    ELECTRON_RENDERER_URL: "http://localhost:5174",
    MYCODE_ENV: "production",
    TEST_SECRET: "private-test-value",
  };
  const kills = [];
  const launch = await createMacDevElectronLaunch({
    appPath: "/runtime/MyCode Dev.app",
    entryPath: "/Project With Spaces/desktop/dev-launch-entry.mjs",
    logDirectory,
    env,
    kill: (pid, signal) => kills.push({ pid, signal }),
  });
  try {
    assert.equal(launch.command, "/usr/bin/open");
    assert.equal((await stat(launch.logPath)).mode & 0o777, 0o600);
    assert.ok(launch.args.includes("-W"));
    assert.ok(launch.args.includes("/Project With Spaces/desktop/dev-launch-entry.mjs"));
    assert.ok(!launch.args.join(" ").includes(env.TEST_SECRET));
    const fileArg = launch.args.find((value) => value.startsWith("--mycode-dev-environment="));
    const file = fileArg.split("=").slice(1).join("=");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).env, env);
    const descriptor = await consumeDevLaunchEnvironment(launch.args);
    assert.deepEqual(descriptor.env, env);
    await assert.rejects(stat(file), { code: "ENOENT" });
    await assert.rejects(
      connectDevLaunchOwner({ ...descriptor, launchId: "other" }, () => {}),
      /before handshake/,
    );
    launch.signal("SIGKILL");
    assert.deepEqual(kills, []);
    let stop;
    const stopped = new Promise((resolve) => {
      stop = resolve;
    });
    const socket = await connectDevLaunchOwner(descriptor, stop);
    assert.deepEqual(kills, [{ pid: process.pid, signal: "SIGKILL" }]);
    launch.signal("SIGTERM");
    await stopped;
    socket.destroy();
    await launch.cleanup();
    launch.signal("SIGKILL");
    assert.equal(kills.length, 1);
    await launch.cleanup();
  } finally {
    await launch.cleanup();
    await rm(logDirectory, { recursive: true, force: true });
  }
});

test("invalid environment is rejected and its temporary file is still removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycode-launch-test-"));
  const file = join(directory, "environment.json");
  try {
    await writeFile(file, JSON.stringify({ INVALID: 42 }), { mode: 0o600 });
    await assert.rejects(
      consumeDevLaunchEnvironment([`--mycode-dev-environment=${file}`]),
      /only string values/,
    );
    await assert.rejects(stat(file), { code: "ENOENT" });
    await assert.rejects(consumeDevLaunchEnvironment([]), /argument is missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
