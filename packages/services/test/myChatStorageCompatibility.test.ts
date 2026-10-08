import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import test from "node:test";
import { decryptLocalSecret, encryptLocalSecret } from "../src/mychat/runtime/local-secret.js";
import {
  MYCHAT_SIDEBAR_WIDTH_KEY,
  readMyChatSidebarWidth,
} from "../../ui/src/mychat/sidebarStorage.js";

test("MyChat reads historical credentials and writes its own authenticated format", () => {
  const context = Buffer.from("4c756d656e206c6f63616c2073656372657473", "hex");
  const key = createHash("sha256").update(context).update(`\0${hostname()}\0${homedir()}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update("fixture-api-key", "utf8"), cipher.final()]);
  const historical =
    Buffer.from("6c756d656e3a76313a", "hex").toString("utf8") +
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  assert.equal(decryptLocalSecret(historical), "fixture-api-key");
  const current = encryptLocalSecret(decryptLocalSecret(historical));
  assert.ok(current.startsWith("mychat:v1:"));
  assert.equal(decryptLocalSecret(current), "fixture-api-key");
  assert.equal(decryptLocalSecret("mychat:v1:invalid"), "");
});

test("MyChat migrates an existing sidebar preference without overwriting a current one", () => {
  const legacyKey = Buffer.from("6c756d656e3a736964656261725f7769647468", "hex").toString("utf8");
  const values = new Map([[legacyKey, "288"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  assert.equal(readMyChatSidebarWidth(storage), "288");
  assert.equal(values.get(MYCHAT_SIDEBAR_WIDTH_KEY), "288");
  assert.equal(values.has(legacyKey), false);
  values.set(legacyKey, "400");
  assert.equal(readMyChatSidebarWidth(storage), "288");
  values.delete(MYCHAT_SIDEBAR_WIDTH_KEY);
  assert.equal(
    readMyChatSidebarWidth({
      ...storage,
      setItem: () => {
        throw new Error("Storage writes blocked");
      },
    }),
    "400",
  );
  assert.equal(values.get(legacyKey), "400");
});
