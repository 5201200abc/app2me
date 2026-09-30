import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getTargetPlatform } from "./target-platform.mjs";

const VERSION = "0.30.4";
const target = getTargetPlatform();
const execFileAsync = promisify(execFile);
const desktopRoot = resolve(import.meta.dirname, "..");
const destination = join(desktopRoot, "bundled-tools", target.key, "cua-driver");
const binaryName = target.os === "win32" ? "cua-driver.exe" : "cua-driver";
const binary = join(destination, binaryName);
const versionFile = join(destination, "version.txt");

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`Cua Driver download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function findBinary(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === binaryName) return path;
    if (entry.isDirectory()) {
      const found = await findBinary(path);
      if (found) return found;
    }
  }
}

async function prepare() {
  if (!["darwin", "win32"].includes(target.os)) return;
  try {
    await access(binary);
    if ((await readFile(versionFile, "utf8")).trim() === VERSION) return;
  } catch {
    /* First checkout has no staged driver. */
  }
  const archiveName =
    target.os === "darwin"
      ? `cua-driver-rs-${VERSION}-darwin-universal-binary.tar.gz`
      : `cua-driver-rs-${VERSION}-windows-${target.arch === "x64" ? "x86_64" : "arm64"}-binary.zip`;
  const base = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}`;
  const cachedArchive = process.argv[2] === "--archive" ? process.argv[3] : undefined;
  const [archive, checksums] = await Promise.all([
    cachedArchive ? readFile(cachedArchive) : download(`${base}/${archiveName}`),
    download(`${base}/checksums.txt`),
  ]);
  const line = checksums
    .toString("utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().split(/\s+/).at(-1)?.replace(/^\*/, "") === archiveName);
  const expected = line?.trim().split(/\s+/)[0];
  if (!expected || createHash("sha256").update(archive).digest("hex") !== expected) {
    throw new Error("Cua Driver release checksum mismatch");
  }
  const temporary = await mkdtemp(join(tmpdir(), "mycode-cua-driver-"));
  try {
    const archivePath = join(temporary, archiveName);
    const extracted = join(temporary, "extracted");
    await mkdir(extracted);
    await writeFile(archivePath, archive);
    await execFileAsync("tar", ["-xf", archivePath, "-C", extracted]);
    const source = await findBinary(extracted);
    if (!source) throw new Error("Cua Driver release does not contain its executable");
    const { stdout } = await execFileAsync(source, ["--version"]);
    if (!stdout.includes(VERSION))
      throw new Error(`Unexpected Cua Driver version: ${stdout.trim()}`);
    await mkdir(destination, { recursive: true });
    await cp(dirname(source), destination, { recursive: true });
    if (target.os !== "win32") await chmod(binary, 0o755);
    await writeFile(join(destination, "checksums.txt"), checksums);
    await writeFile(versionFile, `${VERSION}\n`);
    console.log(`[cua-driver] staged ${VERSION} for ${target.key}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await prepare();
