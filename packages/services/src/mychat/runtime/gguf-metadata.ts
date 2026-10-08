import { open, type FileHandle } from "node:fs/promises";

const VALUE_SIZE: Partial<Record<number, number>> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};

class GgufReader {
  private offset = 0;
  private readonly fd: FileHandle;

  constructor(fd: FileHandle) {
    this.fd = fd;
  }

  async read(length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(length) || length < 0 || length > 64 * 1024 * 1024) {
      throw new Error("Invalid GGUF metadata length.");
    }
    const out = Buffer.allocUnsafe(length);
    const { bytesRead: bytes } = await this.fd.read(out, 0, length, this.offset);
    if (bytes !== length) throw new Error("Unexpected end of GGUF metadata.");
    this.offset += length;
    return out;
  }

  skip(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0)
      throw new Error("Invalid GGUF metadata offset.");
    this.offset += length;
  }

  async u32(): Promise<number> {
    return (await this.read(4)).readUInt32LE(0);
  }

  async u64(): Promise<number> {
    const value = (await this.read(8)).readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("GGUF metadata value is too large.");
    return Number(value);
  }

  async string(capture = true): Promise<string> {
    const length = await this.u64();
    if (!capture) {
      this.skip(length);
      return "";
    }
    return (await this.read(length)).toString("utf8");
  }

  async value(type: number, capture: boolean): Promise<string[]> {
    if (type === 8) return [await this.string(capture)].filter(Boolean);
    if (type === 9) {
      const itemType = await this.u32();
      const count = await this.u64();
      const values: string[] = [];
      for (let index = 0; index < count; index += 1) {
        values.push(...(await this.value(itemType, capture)));
      }
      return values;
    }
    const size = VALUE_SIZE[type];
    if (!size) throw new Error(`Unsupported GGUF metadata type ${type}.`);
    this.skip(size);
    return [];
  }
}

export async function readGgufTextMetadata(path: string): Promise<Record<string, string>> {
  const fd = await open(path, "r");
  try {
    const reader = new GgufReader(fd);
    if ((await reader.read(4)).toString("ascii") !== "GGUF") return {};
    const version = await reader.u32();
    if (version < 2 || version > 3) return {};
    await reader.u64(); // tensor count
    const metadataCount = await reader.u64();
    if (metadataCount > 100_000) return {};
    const wanted = new Set([
      "general.name",
      "general.basename",
      "general.url",
      "general.repo_url",
      "tokenizer.chat_template",
    ]);
    const metadata: Record<string, string> = {};
    for (let index = 0; index < metadataCount; index += 1) {
      const key = await reader.string();
      const type = await reader.u32();
      const capture = wanted.has(key) || key.startsWith("tokenizer.chat_template.");
      const values = await reader.value(type, capture);
      if (capture && values.length) metadata[key] = values.join("\n");
    }
    return metadata;
  } catch {
    return {};
  } finally {
    await fd.close();
  }
}
