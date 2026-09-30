import assert from "node:assert/strict";
import { test } from "node:test";
import { createRemovedOAuthService } from "../src/oauth/oauth.js";

test("retired OAuth RPCs cannot start login or recover a cached session", async () => {
  const service = createRemovedOAuthService();

  assert.deepEqual(await service.getProviders(), []);
  assert.equal(await service.getActiveProvider(), null);
  assert.deepEqual(await service.restoreCachedSessionState(), { status: "signed-out" });
  assert.equal(await service.restoreSession(), null);
  await assert.rejects(service.startOAuth("zai"), /OAuth integration has been removed/);
  await assert.rejects(
    service.startOAuthWithPolling("bigmodel"),
    /OAuth integration has been removed/,
  );
  await assert.rejects(service.refreshToken(), /OAuth integration has been removed/);
});
