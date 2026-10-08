import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const noticePattern = /copyright|licen[sc]e|©/iu;

// 只读原始发布归档，不提取文件、不执行包脚本；避免许可扫描引入路径写入风险。
export function originalTarMembers(gzip, { skipSymbolicLinks = false } = {}) {
  const bytes = gunzipSync(gzip, { maxOutputLength: 128 * 1024 * 1024 });
  const members = new Map();
  let longName;
  let paxPath;
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start, end) => header.subarray(start, end).toString("utf8").split("\0")[0];
    const size = Number.parseInt(string(124, 136).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length)
      throw new Error("Invalid original tar entry");
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    const type = string(156, 157);
    const prefix = string(345, 500);
    const name = longName ?? paxPath ?? `${prefix ? `${prefix}/` : ""}${string(0, 100)}`;
    if (type === "L") longName = content.toString("utf8").split("\0")[0];
    else if (type === "x") paxPath = /\d+ path=([^\n]+)/u.exec(content.toString("utf8"))?.[1];
    else {
      longName = undefined;
      paxPath = undefined;
      if (type === "0" || type === "") {
        if (members.has(name)) throw new Error(`Duplicate original tar member: ${name}`);
        members.set(name, content);
      } else if (!(skipSymbolicLinks && type === "2") && !["5", "g"].includes(type))
        throw new Error(`Unsupported original tar type: ${type}`);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return members;
}

export async function readLicensePublisherReviews(root) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "third-party/publisher-reviews.json"), "utf8"),
  );
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported publisher review schema");
  const verified = new Map();
  const rawInputs = {};
  async function evidence(path, hash) {
    const full = resolve(root, path);
    if (isAbsolute(path) || relative(root, full).startsWith("..") || !/^[a-f0-9]{64}$/u.test(hash))
      throw new Error("Invalid publisher evidence path or hash");
    const bytes = await readFile(full);
    if (digest(bytes) !== hash) throw new Error(`Changed publisher evidence: ${path}`);
    rawInputs[path] = hash;
    return bytes;
  }
  for (const record of manifest.packages) {
    if (!["MIT", "ISC", "BSD-3-Clause"].includes(record.license))
      throw new Error(`Unsupported publisher grant: ${record.package}`);
    const metadata = JSON.parse(await evidence(record.metadataFile, record.metadataSha256));
    const archive = await evidence(record.archiveFile, record.archiveSha256);
    const integrity = metadata.dist?.integrity;
    if (integrity !== record.registryIntegrity || record.source !== metadata.dist?.tarball)
      throw new Error(`Publisher registry identity mismatch: ${record.package}`);
    const [algorithm, expected] = integrity.split("-");
    if (
      !["sha512", "sha256"].includes(algorithm) ||
      createHash(algorithm).update(archive).digest("base64") !== expected
    )
      throw new Error(`Publisher archive integrity mismatch: ${record.package}`);
    const members = originalTarMembers(archive);
    const pkg = JSON.parse(members.get("package/package.json"));
    const declaration = JSON.parse(members.get(record.declarationMember));
    if (
      `${metadata.name}@${metadata.version}` !== record.package ||
      `${pkg.name}@${pkg.version}` !== record.package ||
      declaration.license !== record.license
    )
      throw new Error(`Original publisher grant mismatch: ${record.package}`);
    const actualMembers = [...members].map(([path, bytes]) => ({ path, sha256: digest(bytes) }));
    if (!isDeepStrictEqual(actualMembers, record.members))
      throw new Error(`Incomplete publisher member audit: ${record.package}`);
    const noticeMembers = [...members]
      .filter(([, bytes]) => {
        if (bytes.includes(0)) return false;
        try {
          return noticePattern.test(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch {
          return false;
        }
      })
      .map(([path]) => path);
    if (!isDeepStrictEqual(noticeMembers, record.noticeMembers))
      throw new Error(`Incomplete original notice coverage: ${record.package}`);
    if (verified.has(record.package))
      throw new Error(`Duplicate publisher review: ${record.package}`);
    verified.set(record.package, {
      ...record,
      materials: noticeMembers.map((path) => ({ path, bytes: members.get(path) })),
    });
  }
  return { verified, rawInputs };
}
