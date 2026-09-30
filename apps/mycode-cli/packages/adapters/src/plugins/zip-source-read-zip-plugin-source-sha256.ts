import { join, resolve } from "node:path";
import * as yauzl from "yauzl";
import { directoryExists, fileExists } from "./helpers.js";
import {
  resolveZipPathWithin,
  normalizeZipRelativePath,
  ZIP_MAX_SINGLE_FILE_BYTES,
} from "./zip-source-resolved-zip-plugin-source-root.js";

export function readZipPluginSourceSha256(source: unknown): string | undefined {
  if (!isZipPluginUrlSource(source)) return undefined;
  return source.sha256;
}

export function isZipPluginUrlSource(
  source: unknown,
): source is { source: "url"; type: "zip"; sha256: string; url: string } {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    "source" in source &&
    (source as { source?: unknown }).source === "url" &&
    (source as { type?: unknown }).type === "zip" &&
    typeof (source as { url?: unknown }).url === "string" &&
    typeof (source as { sha256?: unknown }).sha256 === "string"
  );
}

export function resolveZipRoot(input: {
  extractRoot: string;
  path?: string;
  requireSingleRoot?: boolean;
  stripRoot?: boolean;
  topLevelSegments: Set<string>;
}): string {
  const extractRoot = resolve(input.extractRoot);
  if (input.requireSingleRoot && input.topLevelSegments.size !== 1) {
    throw new Error(
      `Plugin zip must contain exactly one top-level directory: ${input.topLevelSegments.size}`,
    );
  }
  if (input.path !== undefined) {
    const requested = resolveZipPathWithin(extractRoot, normalizeZipRelativePath(input.path));
    if (!directoryExists(requested)) {
      throw new Error(`Plugin zip source subdirectory does not exist: ${input.path}`);
    }
    return requested;
  }

  if (hasPluginManifest(extractRoot)) {
    return extractRoot;
  }

  if (input.stripRoot !== false && input.topLevelSegments.size === 1) {
    const [segment] = [...input.topLevelSegments];
    if (segment) {
      const candidate = resolveZipPathWithin(extractRoot, segment);
      if (directoryExists(candidate)) return candidate;
    }
  }

  if (!directoryExists(extractRoot)) {
    throw new Error("Plugin zip did not extract a plugin root directory");
  }
  return extractRoot;
}

export function hasPluginManifest(rootPath: string): boolean {
  return (
    fileExists(join(rootPath, ".mycode-plugin", "plugin.json")) ||
    fileExists(join(rootPath, ".claude-plugin", "plugin.json")) ||
    fileExists(join(rootPath, ".codex-plugin", "plugin.json"))
  );
}

export function readZipEntryBuffer(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      if (!stream) {
        rejectPromise(new Error(`Failed to read plugin zip entry: ${entry.fileName}`));
        return;
      }

      const chunks: Buffer[] = [];
      let bytesRead = 0;
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        stream.destroy(new Error("Plugin operation cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      stream.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesRead += buffer.byteLength;
        if (bytesRead > ZIP_MAX_SINGLE_FILE_BYTES) {
          stream.destroy(
            new Error(`Plugin zip entry exceeds single file limit: ${entry.fileName}`),
          );
          return;
        }
        chunks.push(buffer);
      });
      stream.once("error", (streamError) => {
        cleanup();
        rejectPromise(streamError);
      });
      stream.once("end", () => {
        cleanup();
        resolvePromise(Buffer.concat(chunks));
      });
    });
  });
}
