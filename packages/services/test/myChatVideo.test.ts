import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serializePaths } from "../src/mychat/runtime/attachments.js";
import { fileURLToPath } from "node:url";
const swift = "/usr/bin/swift";
const supported =
  process.platform === "darwin" &&
  (await access(swift).then(
    () => true,
    () => false,
  ));
test(
  "MyChat serializes real native video frames for multimodal requests",
  { skip: !supported },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "mychat-video-"));
    try {
      const file = join(directory, "fixture.mp4");
      await promisify(execFile)(swift, [
        fileURLToPath(new URL("./fixtures/mychat-video.swift", import.meta.url)),
        file,
      ]);
      const files = await serializePaths([file]);
      assert.equal(files[0]?.kind, "video");
      assert.ok((files[0]?.duration ?? 0) > 0);
      assert.ok((files[0]?.frames?.length ?? 0) > 0);
      assert.ok((files[0]?.frames?.length ?? 0) <= 32);
      assert.ok(files[0]?.frames?.every((frame) => frame.startsWith("data:image/jpeg;base64,")));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
