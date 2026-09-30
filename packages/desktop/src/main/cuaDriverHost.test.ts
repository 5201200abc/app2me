import assert from "node:assert/strict";
import { test } from "node:test";
import { createCuaDriverHost } from "./cuaDriverHost.js";

const connection = {
  generation: "g1",
  mcp: { command: "/driver", args: ["mcp", "--socket", "/private.sock"], environment: [] },
};

function fixture(allowed = true) {
  const calls: string[] = [];
  const driver = {
    async start() {
      calls.push("start");
      return connection;
    },
    async stop() {
      calls.push("stop");
    },
    async restart() {
      calls.push("restart");
      return connection;
    },
    uniffiDestroy() {
      calls.push("destroy");
    },
  };
  const host = createCuaDriverHost({
    loadDriver: async () => driver,
    permissions: (request) => {
      calls.push(request ? "request" : "query");
      return { accessibility: allowed, screenRecording: allowed };
    },
    grantOwner: "MyCode",
  });
  return { host, calls, driver };
}

test("status is read only; missing permissions never start a daemon", async () => {
  const { host, calls } = fixture(false);
  assert.equal((await host.execute("status")).kind, "status");
  assert.deepEqual(calls, ["query"]);
  await assert.rejects(host.execute("connect"), /permissions/);
  assert.deepEqual(calls, ["query", "request"]);
});

test("concurrent connections load one owner and disposal destroys it once", async () => {
  const { host, calls } = fixture();
  const results = await Promise.all([host.execute("connect"), host.execute("connect")]);
  assert.ok(results.every((result) => result.kind === "connection"));
  await Promise.all([host.dispose(), host.dispose()]);
  assert.equal(calls.filter((call) => call === "destroy").length, 1);
  await assert.rejects(host.execute("connect"), /disposed/);
});

test("dispose during startup rejects the stale connection", async () => {
  const { host, driver } = fixture();
  let resolveStart!: (value: typeof connection) => void;
  let started!: () => void;
  const startObserved = new Promise<void>((resolve) => {
    started = resolve;
  });
  driver.start = () => {
    started();
    return new Promise((resolve) => {
      resolveStart = resolve;
    });
  };
  const pending = host.execute("connect");
  const rejected = assert.rejects(pending, /disposed/);
  await startObserved;
  const disposed = host.dispose();
  resolveStart(connection);
  await rejected;
  await disposed;
});

test("disposal during an asynchronous permission request does not load a driver", async () => {
  let resolvePermissions!: (value: { accessibility: boolean; screenRecording: boolean }) => void;
  const host = createCuaDriverHost({
    permissions: () =>
      new Promise((resolve) => {
        resolvePermissions = resolve;
      }),
    loadDriver: async () => {
      assert.fail("disposed permission request loaded driver");
    },
    grantOwner: "MyCode",
  });
  const rejected = assert.rejects(host.execute("connect"), /disposed/);
  await host.dispose();
  resolvePermissions({ accessibility: true, screenRecording: true });
  await rejected;
});
