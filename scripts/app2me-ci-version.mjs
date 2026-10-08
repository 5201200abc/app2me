import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "./app2me-release.mjs";
import { resolveApp2meReleaseIdentity } from "./app2me-release-identity.mjs";

const manifests = ["package.json", "packages/desktop/package.json"];

export function nextReleaseVersion(previous, now = new Date(), previousWindowsVersion) {
  const identity = resolveApp2meReleaseIdentity(now.toISOString().slice(0, 10), now);
  // 同一秒内合并或重试仍需单调递增；不退回旧的 3.x 开发版本。
  const parts = previous.split(".").map(Number);
  const candidate = identity.appVersion.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0))
    throw new Error(`Invalid current version: ${previous}`);
  if (parts[0] > candidate[0] || (parts[0] === candidate[0] && parts[1] > candidate[1]))
    throw new Error("Release clock precedes the current version");
  if (parts[0] === candidate[0] && parts[1] === candidate[1])
    candidate[2] = Math.max(candidate[2], parts[2] + 1);
  if (previousWindowsVersion) {
    const oldWindows = previousWindowsVersion.split(".").map(Number);
    const windows = identity.windowsBuildVersion.split(".").map(Number);
    if (
      oldWindows.length !== 4 ||
      oldWindows.some((part) => !Number.isSafeInteger(part) || part < 0)
    )
      throw new Error("Invalid previous Windows version");
    if (windows.slice(0, 3).every((part, index) => part === oldWindows[index]))
      windows[3] = Math.max(windows[3], oldWindows[3] + 1);
    if (windows.some((part) => part > 65535)) throw new Error("Windows version field overflow");
    identity.windowsBuildVersion = windows.join(".");
  }
  return { ...identity, appVersion: candidate.join(".") };
}

async function outputs(sha, pkg) {
  const identity = pkg.app2meRelease;
  if (!identity?.date || !identity.windowsBuildVersion)
    throw new Error("Release commit has no shared identity");
  const values = {
    sha,
    version: pkg.version,
    date: identity.date,
    windows_version: identity.windowsBuildVersion,
  };
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(JSON.stringify(values));
  return values;
}

export async function prepareVersion(
  source,
  branch = "main",
  git = (args) => run("git", args, { capture: true }),
) {
  const isPR = Number.isSafeInteger(source) && source > 0;
  const isCommit = typeof source === "string" && /^[a-f0-9]{40}$/.test(source);
  if ((!isPR && !isCommit) || !/^[\w./-]+$/.test(branch) || branch.startsWith("-"))
    throw new Error("Invalid release identity");
  const trailer = `${isPR ? "Release-PR" : "Release-Commit"}: ${source}`;
  const field = isPR ? "pullRequest" : "sourceCommit";
  for (let attempt = 0; attempt < 5; attempt++) {
    await git(["fetch", "origin", branch]);
    const ref = `origin/${branch}`;
    const existing = (await git(["log", ref, "--format=%H", "--fixed-strings", "--grep", trailer]))
      .trim()
      .split("\n");
    for (const sha of existing.filter(Boolean)) {
      const pkg = JSON.parse(await git(["show", `${sha}:package.json`]));
      if (pkg.app2meRelease?.[field] === source) return outputs(sha, pkg);
    }
    if (isCommit) {
      await git(["merge-base", "--is-ancestor", source, ref]);
      const prepared = JSON.parse(await git(["show", `${source}:package.json`]));
      const parent = JSON.parse(await git(["show", `${source}^:package.json`]));
      if (prepared.app2meRelease?.prepared === true && prepared.version !== parent.version) {
        const desktop = JSON.parse(await git(["show", `${source}:packages/desktop/package.json`]));
        const old = parent.version.split(".").map(Number);
        const next = prepared.version.split(".").map(Number);
        const increasing =
          next.length === 3 &&
          next.every(Number.isSafeInteger) &&
          next.some(
            (value, index) =>
              value > old[index] && next.slice(0, index).every((part, i) => part === old[i]),
          );
        if (!increasing || desktop.version !== prepared.version)
          throw new Error("Prepared source commit has no increasing shared version");
        return outputs(source, prepared);
      }
    }
    await git(["checkout", "-B", "app2me-ci-version", ref]);
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const identity = nextReleaseVersion(
      pkg.version,
      new Date(),
      pkg.app2meRelease?.windowsBuildVersion,
    );
    for (const file of manifests) {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.version = identity.appVersion;
      if (file === "package.json")
        manifest.app2meRelease = {
          [field]: source,
          date: identity.date,
          windowsBuildVersion: identity.windowsBuildVersion,
        };
      await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await git(["config", "user.name", process.env.RELEASE_GIT_NAME ?? "5201200abc"]);
    await git(["config", "user.email", process.env.RELEASE_GIT_EMAIL ?? "5201200abc@gmail.com"]);
    await git(["add", "--", ...manifests]);
    await git(["commit", "-m", `chore: release ${identity.appVersion}\n\n${trailer}`]);
    const sha = (await git(["rev-parse", "HEAD"])).trim();
    try {
      await git(["push", "origin", `HEAD:refs/heads/${branch}`]);
    } catch (error) {
      if (attempt === 4) throw error;
      continue;
    }
    return outputs(sha, JSON.parse(await readFile("package.json", "utf8")));
  }
}

export async function preparePushVersions(
  after,
  before,
  branch = "main",
  git = (args) => run("git", args, { capture: true }),
) {
  if (!/^[a-f0-9]{40}$/.test(after) || (before && !/^[a-f0-9]{40}$/.test(before)))
    throw new Error("Invalid push identity");
  await git(["fetch", "origin", branch]);
  await git(["merge-base", "--is-ancestor", after, `origin/${branch}`]);
  const range = before && !/^0+$/.test(before) ? `${before}..${after}` : `${after}^..${after}`;
  const commits = (await git(["rev-list", "--reverse", "--first-parent", range]))
    .trim()
    .split("\n")
    .filter(Boolean);
  let result;
  for (const commit of commits) {
    const message = await git(["show", "-s", "--format=%B", commit]);
    if (/^Release-(?:Commit|PR): /m.test(message)) continue;
    try {
      await git(["cat-file", "-e", `${commit}:.github/workflows/release.yml`]);
    } catch {
      continue;
    }
    result = await prepareVersion(commit, branch, git);
  }
  if (!result) throw new Error("Push contains no unprocessed source commit");
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // checkout/reset/push 只允许在 CI 的临时工作区内执行，不能改写本地未提交工作。
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Version preparation is CI-only");
  if (process.argv[2] === "--push")
    await preparePushVersions(process.argv[3], process.argv[4], process.argv[5] ?? "main");
  else await prepareVersion(Number(process.argv[2]), process.argv[3] ?? "main");
}
