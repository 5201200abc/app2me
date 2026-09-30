import assert from "node:assert/strict";
import { test } from "node:test";
import { hostCuaDriverRequestSchema, hostCuaDriverResultSchema } from "../src/cua-driver.js";

test("Cua Driver IPC validates scope and rejects unknown operations and connection fields", () => {
  const request = {
    type: "cua-driver-request",
    requestId: "r1",
    operation: "connect",
    workspacePath: "/local",
    workspaceIdentity: "identity",
    remoteSessionId: "remote",
  };
  assert.deepEqual(hostCuaDriverRequestSchema.parse(request), request);
  assert.equal(
    hostCuaDriverRequestSchema.safeParse({ ...request, operation: "shell" }).success,
    false,
  );
  assert.equal(hostCuaDriverRequestSchema.safeParse({ ...request, extra: true }).success, false);
  const result = {
    type: "cua-driver-result",
    requestId: "r1",
    result: { kind: "connection", generation: "g1", command: "/driver", args: ["mcp"], env: {} },
  };
  assert.deepEqual(hostCuaDriverResultSchema.parse(result), result);
  assert.equal(
    hostCuaDriverResultSchema.safeParse({ ...result, result: { ...result.result, generation: "" } })
      .success,
    false,
  );
  assert.equal(
    hostCuaDriverResultSchema.safeParse({
      ...result,
      result: { ...result.result, env: { invalid: 42 } },
    }).success,
    false,
  );
});
