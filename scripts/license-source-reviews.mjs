import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function readLicenseSourceReviews(root) {
  const file = "third-party/source-reviews.json";
  const manifest = JSON.parse(await readFile(resolve(root, file), "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported source review schema");
  if (!manifest.rustAudit || !manifest.cargoLocks?.length)
    throw new Error("Missing Rust audit or Cargo lock evidence");
  const mplCrates = new Set();
  const verified = new Map();
  const rawInputs = {};
  async function evidence(path, expected) {
    const full = resolve(root, path);
    if (
      isAbsolute(path) ||
      relative(root, full).startsWith("..") ||
      !/^[a-f0-9]{64}$/.test(expected)
    )
      throw new Error("Invalid source evidence path or hash");
    const bytes = await readFile(full);
    if (hash(bytes) !== expected) throw new Error(`Changed source evidence: ${path}`);
    rawInputs[path] = expected;
    return bytes;
  }
  const archives = new Map();
  const cargoChecksums = new Map();
  for (const lock of manifest.cargoLocks ?? []) {
    const text = (await evidence(lock.file, lock.sha256)).toString("utf8");
    for (const block of text.split("[[package]]").slice(1)) {
      const name = /^name = "([^"]+)"/m.exec(block)?.[1];
      const version = /^version = "([^"]+)"/m.exec(block)?.[1];
      const checksum = /^checksum = "([a-f0-9]{64})"/m.exec(block)?.[1];
      if (name && version && checksum) cargoChecksums.set(`${name}@${version}`, checksum);
    }
  }
  for (const archive of manifest.archives) {
    const gitSource =
      /^[a-f0-9]{40}$/.test(archive.revision ?? "") &&
      archive.source ===
        `https://codeload.github.com/${archive.repository}/tar.gz/${archive.revision}`;
    const crateSource =
      archive.source ===
        `https://static.crates.io/crates/${archive.name}/${archive.name}-${archive.version}.crate` &&
      archive.sha256 === archive.cargoChecksum &&
      cargoChecksums.get(`${archive.name}@${archive.version}`) === archive.sha256;
    if (!gitSource && !crateSource) throw new Error(`Invalid immutable source URL: ${archive.id}`);
    await evidence(archive.file, archive.sha256);
    archives.set(archive.id, archive);
  }
  if (manifest.rustAudit) {
    const audit = JSON.parse(await evidence(manifest.rustAudit.file, manifest.rustAudit.sha256));
    const audited = new Map(audit.packages.map((item) => [`${item.name}@${item.version}`, item]));
    for (const [name, checksum] of cargoChecksums) {
      const item = audited.get(name);
      if (!item?.license || item.checksum !== checksum)
        throw new Error(`Incomplete Rust license audit: ${name}`);
      if (item.license.includes("MPL")) {
        mplCrates.add(name);
        if (!archives.has(name)) throw new Error(`Missing MPL crate source: ${name}`);
      }
    }
  }
  for (const record of manifest.packages) {
    if (!["MPL-2.0", "MIT AND MPL-2.0"].includes(record.license))
      throw new Error(`Unsupported source review license: ${record.package}`);
    const metadata = JSON.parse(await evidence(record.metadataFile, record.metadataSha256));
    if (
      `${metadata.name}@${metadata.version}` !== record.package ||
      metadata.license !== record.license
    )
      throw new Error(`Publisher metadata mismatch: ${record.package}`);
    const sources = record.sources.map((id) => {
      const archive = archives.get(id);
      if (!archive) throw new Error(`Missing corresponding source: ${record.package}`);
      return archive;
    });
    if (!sources.length) throw new Error(`No corresponding source: ${record.package}`);
    for (const id of mplCrates) {
      if (!record.sources.includes(id))
        throw new Error(`Missing package MPL source: ${record.package}: ${id}`);
    }
    const repository = (metadata.repository?.url ?? "")
      .replace(/^git\+/, "")
      .replace(/\.git$/, "")
      .replace("https://github.com/", "");
    if (metadata.gitHead) {
      if (
        !sources.some(
          (source) => source.revision === metadata.gitHead && source.repository === repository,
        )
      )
        throw new Error(`Publisher source revision mismatch: ${record.package}`);
    } else {
      const tag = JSON.parse(await evidence(record.releaseTag.file, record.releaseTag.sha256));
      if (
        tag.ref !== `refs/tags/cua-driver-rs-v${metadata.version}` ||
        tag.object.type !== "commit" ||
        tag.url !==
          `https://api.github.com/repos/${repository}/git/refs/tags/cua-driver-rs-v${metadata.version}` ||
        record.sourceRevision !== tag.object.sha
      )
        throw new Error(`Publisher release tag mismatch: ${record.package}`);
    }
    if (verified.has(record.package)) throw new Error(`Duplicate source review: ${record.package}`);
    verified.set(record.package, { ...record, sources });
  }
  return { manifest, verified, rawInputs };
}
