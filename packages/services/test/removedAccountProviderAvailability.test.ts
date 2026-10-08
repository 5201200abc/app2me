import assert from "node:assert/strict";
import test from "node:test";
import {
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
} from "../src/official-mcp/officialMcpCredentials.js";

test("retired account MCP auth never reads credentials or contacts external dependencies", async () => {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error("retired dependency accessed");
      },
    },
  );
  const unavailable = { ok: false, reason: "official_auth_unavailable" };
  assert.deepEqual(await resolveOfficialMcpCredentials(forbidden as never), unavailable);
  assert.deepEqual(
    await createOfficialMcpAuthHeadersResolver(forbidden as never).resolveHeaders(),
    unavailable,
  );
});
