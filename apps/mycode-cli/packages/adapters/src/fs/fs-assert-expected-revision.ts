import { stat } from "node:fs/promises";

import { createFileSystemError, type FileSystemRevision } from "@mycode/contracts";

import { revisionId } from "./fs-node-file-system-adapter-options.js";

export async function assertExpectedRevision(
  path: string,
  expected: FileSystemRevision,
): Promise<void> {
  const info = await stat(path);
  const actual = revisionId(info.mtimeMs, info.size);
  if (actual !== expected.id) {
    throw createFileSystemError({
      code: "stale_write",
      path,
      message: `File changed since it was read: ${path}`,
    });
  }
}
