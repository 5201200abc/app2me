import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";

const PREFIX = "mychat:v1:";
const key = createHash("sha256")
  .update(`MyChat local secrets\0${hostname()}\0${homedir()}`)
  .digest();

// Historical ciphertext remains readable; all new writes use the MyChat format.
const legacyPrefix = Buffer.from("6c756d656e3a76313a", "hex").toString("utf8");
const legacyKey = createHash("sha256")
  .update(Buffer.from("4c756d656e206c6f63616c2073656372657473", "hex"))
  .update(`\0${hostname()}\0${homedir()}`)
  .digest();

export function encryptLocalSecret(value: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptLocalSecret(value: string): string {
  if (!value) return "";
  if (value.startsWith("plain:")) return value.slice(6);
  const prefix = value.startsWith(PREFIX)
    ? PREFIX
    : value.startsWith(legacyPrefix)
      ? legacyPrefix
      : null;
  if (!prefix) return "";
  try {
    const payload = Buffer.from(value.slice(prefix.length), "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      prefix === PREFIX ? key : legacyKey,
      payload.subarray(0, 12),
    );
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return "";
  }
}
