import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRemoteWorkspaceIdentity } from "@mycode/shared";
import { isCuaPermissionStatusAvailable } from "@mycode/services";
import { createCuaDriverMainBridge } from "./cuaDriverMainBridge.js";

test("injects into an empty list, preserves browser and replaces only its own server", async () => {
  const bridge = createCuaDriverMainBridge({
    postToMain(message) {
      bridge.handleResult({
        requestId: message.requestId,
        result: {
          kind: "connection",
          generation: "g1",
          command: "/driver",
          args: ["mcp"],
          env: {},
        },
      });
    },
    isEnabled: () => true,
    hasActiveTurn: () => false,
  });
  const injected = await bridge.resolver.resolveMcpServers(undefined, { workspacePath: "/local" });
  assert.equal(injected?.length, 1);
  const browser = { name: "browser", type: "stdio", command: "browser" };
  const servers = await bridge.resolver.resolveMcpServers([browser, ...injected!], {
    workspacePath: "/local",
  });
  assert.equal(servers?.length, 2);
  assert.equal(servers?.[0], browser);
});

test("remote scopes never request local desktop; disabled gate leaves servers alone", async () => {
  const bridge = createCuaDriverMainBridge({
    postToMain() {
      assert.fail("remote scope touched Main");
    },
    isEnabled: () => true,
    hasActiveTurn: () => false,
  });
  assert.equal(
    await bridge.resolver.resolveMcpServers(undefined, { remoteSessionId: "remote" }),
    undefined,
  );
  const workspaceIdentity = buildRemoteWorkspaceIdentity("/local", {
    kind: "ssh",
    host: "host",
    username: "user",
  });
  assert.equal(
    await bridge.resolver.resolveMcpServers(undefined, { workspaceIdentity }),
    undefined,
  );
  const disabled = createCuaDriverMainBridge({
    postToMain() {
      assert.fail("disabled plugin touched Main");
    },
    isEnabled: async () => false,
    hasActiveTurn: () => false,
  });
  const servers = [{ name: "browser" }];
  assert.equal(
    await disabled.resolver.resolveMcpServers(servers, { workspacePath: "/local" }),
    servers,
  );
  disabled.dispose();
});

test("a user server with the reserved name is preserved without starting a driver", async () => {
  const warnings: Error[] = [];
  const bridge = createCuaDriverMainBridge({
    postToMain() {
      assert.fail("conflicting config started driver");
    },
    isEnabled: () => true,
    hasActiveTurn: () => false,
    onUnavailable: (error) => warnings.push(error),
  });
  const servers = [{ name: "cua_driver", command: "/user-server" }];
  assert.equal(
    await bridge.resolver.resolveMcpServers(servers, { workspacePath: "/local" }),
    servers,
  );
  assert.match(warnings[0]!.message, /conflicts/);
  bridge.dispose();
});

test("active turn blocks restart and disposal settles pending requests", async () => {
  const bridge = createCuaDriverMainBridge({
    postToMain() {},
    isEnabled: () => true,
    hasActiveTurn: () => true,
  });
  await assert.rejects(bridge.resolver.restart(), /active turn/);
  const pending = bridge.resolver.resolveMcpServers(undefined, { workspacePath: "/local" });
  const rejected = assert.rejects(pending, /disposed/);
  bridge.dispose();
  await rejected;
});

test("read-only native permission status does not fabricate functional probe results", async () => {
  const bridge = createCuaDriverMainBridge({
    postToMain(message) {
      bridge.handleResult({
        requestId: message.requestId,
        result: {
          kind: "status",
          grantOwner: "MyCode Dev",
          accessibility: true,
          screenRecording: true,
        },
      });
    },
    isEnabled: () => true,
    hasActiveTurn: () => false,
  });
  const status = await bridge.permissionService.getStatus("/local");
  assert.equal(isCuaPermissionStatusAvailable(status), true);
  assert.ok("accessibility" in status);
  assert.equal(status.grantOwnerDisplayName, "MyCode Dev");
  assert.equal(status.accessibility, "granted");
  assert.equal(status.screenRecording, "granted");
  assert.ok(!("accessibilityProbeOk" in status));
  assert.ok(!("screenCaptureProbeOk" in status));
  bridge.dispose();
});
