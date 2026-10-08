import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveApp2meReleaseIdentity } from "./app2me-release-identity.mjs";
import { withPinnedNodePath } from "./mise-toolchain-env.mjs";
import { parse as parseYaml } from "yaml";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repository = "5201200abc/app2me";
const tag = "latest";
const datedReleasePattern = /^app2me-\d{4}-\d{2}-\d{2}$/;
const installerPattern = /\.(?:dmg|zip|exe|AppImage|deb|rpm|pkg\.tar\.zst)$/i;
const assetPattern = /\.(?:dmg|zip|exe|AppImage|deb|rpm|pkg\.tar\.zst|blockmap|yml)$/i;

export async function run(
  command,
  args,
  { cwd = projectRoot, env = process.env, capture = false } = {},
) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    let error = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? accept(output) : reject(new Error(`${command} failed (${code}): ${error}`)),
    );
  });
}

export async function withReleaseLock(releaseRoot, action) {
  await mkdir(releaseRoot, { recursive: true });
  const lockPath = join(releaseRoot, ".release.lock");
  const ownerPath = join(releaseRoot, `.lock-owner-${randomUUID()}`);
  // 先完整写入 owner，再原子 link 排他锁，避免并发进程读取尚未写完的 JSON。
  await writeFile(ownerPath, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  try {
    await link(ownerPath, lockPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    try {
      process.kill(owner.pid, 0);
    } catch (probeError) {
      if (probeError.code !== "ESRCH") throw probeError;
      // 不自动删除旧锁：两个恢复进程同时 unlink，可能误删另一个进程刚取得的新锁。
      throw new Error(
        `app2me stale release lock (pid ${owner.pid} no longer exists); inspect and remove ${lockPath}`,
      );
    }
    throw new Error(`app2me release is already running (pid ${owner.pid})`);
  } finally {
    await rm(ownerPath, { force: true });
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function digestFile(path, algorithm = "sha256", encoding = "hex") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function createReleaseManifest(directory, identity) {
  const assets = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !assetPattern.test(entry.name)) continue;
    if (entry.name.endsWith(".yml") && !/^latest(?:-[a-z0-9]+)*\.yml$/.test(entry.name)) continue;
    if (installerPattern.test(entry.name) && !entry.name.startsWith(`${identity.releaseName}-`)) {
      throw new Error(`Unexpected app2me artifact: ${entry.name}`);
    }
    const path = join(directory, entry.name);
    assets.push({
      name: entry.name,
      size: (await stat(path)).size,
      sha256: await digestFile(path),
    });
  }
  if (!assets.some((asset) => installerPattern.test(asset.name)))
    throw new Error("No app2me installer was built");
  for (const asset of assets.filter((item) => item.name.endsWith(".yml"))) {
    const feed = parseYaml(await readFile(join(directory, asset.name), "utf8"));
    if (feed.version !== identity.appVersion || !feed.files?.length)
      throw new Error(`Invalid app2me update feed: ${asset.name}`);
    for (const file of feed.files) {
      const installer = assets.find((item) => item.name === file.url);
      if (
        !installer ||
        installer.size !== file.size ||
        (await digestFile(join(directory, installer.name), "sha512", "base64")) !== file.sha512
      ) {
        throw new Error(`app2me update feed checksum mismatch: ${file.url}`);
      }
    }
  }
  const manifest = { ...identity, assets: assets.sort((a, b) => a.name.localeCompare(b.name)) };
  await writeFile(join(directory, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function verifyRelease(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "release.json"), "utf8"));
  if (
    manifest.releaseName !== resolveApp2meReleaseIdentity(manifest.date).releaseName ||
    !manifest.assets?.length
  ) {
    throw new Error("Invalid app2me release manifest");
  }
  for (const asset of manifest.assets) {
    if (asset.name !== basename(asset.name)) throw new Error("Unsafe release asset path");
    const path = join(directory, asset.name);
    if ((await stat(path)).size !== asset.size || (await digestFile(path)) !== asset.sha256) {
      throw new Error(`app2me release checksum mismatch: ${asset.name}`);
    }
  }
  return manifest;
}

export async function promoteRelease(staging, releaseRoot) {
  await verifyRelease(staging);
  const current = join(releaseRoot, "current");
  const previous = join(releaseRoot, `.previous-${randomUUID()}`);
  let hadPrevious = false;
  try {
    await rename(current, previous);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, current);
  } catch (error) {
    if (hadPrevious) await rename(previous, current);
    throw error;
  }
  if (hadPrevious) await rm(previous, { recursive: true, force: true });
  // 仅删除本产品旧日期目录；不把其它内容当成历史版本清理。
  for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
    if (/^app2me-\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      await rm(join(releaseRoot, entry.name), { recursive: true, force: true });
    }
  }
  return current;
}

export async function publishRelease(
  directory,
  { gh = (args) => run("gh", args, { capture: true }) } = {},
) {
  const manifest = await verifyRelease(directory);
  const api = (path, ...args) => gh(["api", `repos/${repository}/${path}`, ...args]);
  const list = async (path) => JSON.parse(await api(path, "--paginate", "--slurp")).flat();
  const releases = await list("releases?per_page=100");
  let current = releases.find((release) => release.tag_name === tag);
  if (!current) {
    await gh([
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--title",
      manifest.releaseName,
      "--notes",
      "app2me — MyCode / MyChat",
      "--draft",
    ]);
    // draft 尚未生成 tag，按 tag 读取会 404；草稿上传必须使用 releases 列表中的真实 ID。
    current = (await list("releases?per_page=100")).find((release) => release.tag_name === tag);
    if (!current) throw new Error("Created app2me draft release was not found");
  }
  const uploadDir = join(directory, `.upload-${randomUUID()}`);
  await mkdir(uploadDir);
  const pending = [];
  let committing = false;
  try {
    // 临时名称避免同日覆盖时 gh --clobber 先删除旧包；校验新包后才清理旧资产。
    // 安装格式彼此独立，可并发传输；必须等全部请求结束后再校验或回滚，避免清理时仍有上传写入。
    const uploads = await Promise.allSettled(
      manifest.assets.map(async (asset) => {
        const name = `pending-${randomUUID()}-${asset.name}`;
        const path = join(uploadDir, name);
        pending.push({ ...asset, pendingName: name });
        await link(join(directory, asset.name), path);
        await gh(["release", "upload", tag, path, "--repo", repository]);
      }),
    );
    const failed = uploads.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const uploaded = await list(`releases/${current.id}/assets?per_page=100`);
    for (const asset of pending) {
      const remote = uploaded.find((item) => item.name === asset.pendingName);
      if (!remote || remote.size !== asset.size || remote.digest !== `sha256:${asset.sha256}`) {
        throw new Error(`GitHub asset verification failed: ${asset.name}`);
      }
      asset.remoteId = remote.id;
    }
    const keep = new Set(pending.map((asset) => asset.remoteId));
    committing = true;
    for (const asset of uploaded) {
      if (!keep.has(asset.id)) await api(`releases/assets/${asset.id}`, "--method", "DELETE");
    }
    for (const asset of pending) {
      await api(
        `releases/assets/${asset.remoteId}`,
        "--method",
        "PATCH",
        "-f",
        `name=${asset.name}`,
      );
    }
    await gh([
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--title",
      manifest.releaseName,
      "--draft=false",
      "--latest",
      "--notes",
      `app2me — MyCode / MyChat\n${manifest.releaseName}\nSHA-256 verified; replaces the previous app2me distribution.`,
    ]);
    for (const release of releases) {
      if (
        release.tag_name !== tag &&
        // 日期 tag 的发布可能有自定义标题；不能让标题覆盖 tag 的归属判断。
        (datedReleasePattern.test(release.name ?? "") || datedReleasePattern.test(release.tag_name))
      ) {
        await gh([
          "release",
          "delete",
          release.tag_name,
          "--repo",
          repository,
          "--cleanup-tag",
          "--yes",
        ]);
      }
    }
    const final = JSON.parse(await api(`releases/tags/${tag}`));
    const finalAssets = await list(`releases/${final.id}/assets?per_page=100`);
    if (
      final.draft ||
      final.name !== manifest.releaseName ||
      finalAssets.length !== pending.length ||
      pending.some(
        (asset) =>
          !finalAssets.some(
            (item) => item.name === asset.name && item.digest === `sha256:${asset.sha256}`,
          ),
      )
    ) {
      throw new Error("GitHub latest release verification failed");
    }
    return final.html_url;
  } catch (error) {
    if (!committing) {
      // 上传或校验失败时仅清理本次临时资产，旧发布保持可用。
      const names = new Set(pending.map((asset) => asset.pendingName));
      for (const asset of await list(`releases/${current.id}/assets?per_page=100`)) {
        if (names.has(asset.name)) await api(`releases/assets/${asset.id}`, "--method", "DELETE");
      }
    }
    throw error;
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {
    date: undefined,
    publish: false,
    os: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux",
    arch: process.arch,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--publish") options.publish = true;
    else if (["--date", "--os", "--arch"].includes(arg)) {
      if (!argv[i + 1]) throw new Error(`Missing ${arg} value`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg === "--help") {
      console.log(
        "pnpm release [--date YYYY-MM-DD] [--os mac|win|linux] [--arch arm64|x64] [--publish]\nOne app2me distribution in releases/current; --publish replaces GitHub latest.",
      );
      return;
    } else throw new Error(`Unknown release option: ${arg}`);
  }
  if (!["mac", "win", "linux"].includes(options.os) || !["arm64", "x64"].includes(options.arch))
    throw new Error("Unsupported app2me release target");
  const identity = resolveApp2meReleaseIdentity(options.date);
  if (process.env.GITHUB_ACTIONS === "true") {
    const stamp = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
    if (!stamp.app2meRelease || stamp.app2meRelease.date !== identity.date)
      throw new Error("CI release must use the prepared shared identity");
    identity.appVersion = stamp.version;
    identity.windowsBuildVersion = stamp.app2meRelease.windowsBuildVersion;
  }
  const releaseRoot = join(projectRoot, "releases");
  await withReleaseLock(releaseRoot, async () => {
    const stagingRoot = join(releaseRoot, `.staging-${randomUUID()}`);
    const staging = join(stagingRoot, "artifacts");
    await mkdir(stagingRoot);
    try {
      const env = {
        ...withPinnedNodePath(process.env, process.execPath),
        MYCODE_ENV: "production",
        MYCODE_PREVIEW_IDENTITY: "0",
        MYCODE_DESKTOP_DIST_DIR: staging,
        APP2ME_RELEASE_DATE: identity.date,
        APP2ME_APP_VERSION: identity.appVersion,
        APP2ME_WINDOWS_BUILD_VERSION: identity.windowsBuildVersion,
        APP2ME_UPDATE_CHANNEL: `latest-${options.arch}`,
      };
      await run(process.execPath, ["packages/desktop/scripts/build-metadata.mjs"], { env });
      await run(
        process.execPath,
        ["packages/desktop/scripts/bundle.mjs", "--os", options.os, "--arch", options.arch],
        { env },
      );
      await createReleaseManifest(staging, identity);
      const url = options.publish ? await publishRelease(staging) : null;
      const current = await promoteRelease(staging, releaseRoot);
      console.log(`${identity.releaseName}: ${current}${url ? `\n${url}` : ""}`);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
