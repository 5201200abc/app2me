import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { originalTarMembers, readLicensePublisherReviews } from "./license-publisher-reviews.mjs";
import { wasmProducerSection } from "./license-wasm-producers.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlob = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export async function readLicenseEmbeddedReviews(root, components) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "third-party/embedded-reviews.json"), "utf8"),
  );
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported embedded review schema");
  const rawInputs = {};
  const verified = new Set();
  async function evidence(record) {
    const path = resolve(root, record.file);
    if (isAbsolute(record.file) || relative(root, path).startsWith(".."))
      throw new Error("Invalid embedded evidence path");
    const bytes = await readFile(path);
    if (hash(bytes) !== record.sha256) throw new Error(`Changed embedded evidence: ${record.file}`);
    rawInputs[record.file] = record.sha256;
    return bytes;
  }
  const json = async (record) => JSON.parse(await evidence(record));
  async function noticeCoverage(component, checksums) {
    for (const checksum of checksums) {
      const notice = component.notices.find((item) => item.sha256 === checksum);
      if (!notice) throw new Error(`Missing embedded original notice: ${component.id}`);
      await evidence(notice);
    }
  }
  const qjs = manifest.quickjs;
  const component = components.find(
    (item) => item.id === "QuickJS-NG" && item.parentPackage === qjs.package,
  );
  if (!component || component.revision !== qjs.engineRevision)
    throw new Error("QuickJS component identity mismatch");
  const tree = await json(qjs.sourceTree);
  if (
    tree.sha !== qjs.sourceRevision ||
    tree.truncated ||
    tree.tree.find((item) => item.path === "quickjs-ng")?.sha !== qjs.engineRevision
  )
    throw new Error("QuickJS submodule identity mismatch");
  if (
    qjs.sourceArchive.source !==
    `https://codeload.github.com/vercel-labs/quickjs-wasi/tar.gz/${qjs.sourceRevision}`
  )
    throw new Error("Invalid QuickJS immutable source URL");
  const source = originalTarMembers(await evidence(qjs.sourceArchive));
  const prefix = `quickjs-wasi-${qjs.sourceRevision}/`;
  const pkg = JSON.parse(source.get(`${prefix}package.json`));
  if (`${pkg.name}@${pkg.version}` !== qjs.package)
    throw new Error("QuickJS source package version mismatch");
  for (const path of ["package.json", "Makefile"])
    if (gitBlob(source.get(prefix + path)) !== tree.tree.find((item) => item.path === path)?.sha)
      throw new Error("QuickJS original source blob mismatch");
  if (!source.get(`${prefix}Makefile`).toString("utf8").includes("WASI_SDK_VERSION_REQUIRED = 32"))
    throw new Error("QuickJS SDK version mismatch");
  const sdk = await json(qjs.sdkTree);
  if (
    sdk.sha !== qjs.sdkRevision ||
    sdk.tree.find((item) => item.path === "src/llvm-project")?.sha !== qjs.llvmRevision ||
    sdk.tree.find((item) => item.path === "src/wasi-libc")?.sha !== qjs.libcRevision
  )
    throw new Error("WASI SDK linked-source mismatch");
  const publishers = await readLicensePublisherReviews(root);
  const publisher = publishers.verified.get(qjs.package);
  if (!publisher) throw new Error("Missing original QuickJS publisher archive");
  const members = originalTarMembers(await readFile(resolve(root, publisher.archiveFile)));
  const wasmFiles = [...members].filter(([, bytes]) =>
    bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])),
  );
  if (wasmFiles.length !== 7) throw new Error("Unreviewed QuickJS WASM component set");
  for (const [path, bytes] of wasmFiles)
    if (!wasmProducerSection(bytes).includes(qjs.llvmRevision))
      throw new Error(`QuickJS WASM compiler identity mismatch: ${path}`);
  await noticeCoverage(component, qjs.requiredNotices);
  for (const revision of [qjs.llvmRevision, qjs.libcRevision])
    if (!component.notices.some((item) => item.source.includes(revision)))
      throw new Error("Missing exact WASI linked-library notices");
  verified.add("QuickJS-NG");
  return { verified, rawInputs: { ...rawInputs, ...publishers.rawInputs } };
}
