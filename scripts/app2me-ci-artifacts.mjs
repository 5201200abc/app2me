import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createReleaseManifest, publishRelease, verifyRelease } from "./app2me-release.mjs";

export const releaseTargets = [
  "mac-x64",
  "mac-arm64",
  "win-x64",
  "win-arm64",
  "linux-x64",
  "linux-arm64",
];

export async function assembleRelease(input, output, targets = releaseTargets, expectedIdentity) {
  const entries = await readdir(input, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(names) !== JSON.stringify([...targets].sort()))
    throw new Error("Release requires exactly the expected architecture artifacts");
  const seen = new Set();
  let identity;
  await mkdir(output, { recursive: false });
  for (const target of targets) {
    const directory = join(input, target);
    const manifest = await verifyRelease(directory);
    const current = {
      releaseName: manifest.releaseName,
      date: manifest.date,
      appVersion: manifest.appVersion,
      windowsBuildVersion: manifest.windowsBuildVersion,
    };
    if (expectedIdentity && JSON.stringify(current) !== JSON.stringify(expectedIdentity))
      throw new Error(`Release identity differs from the prepared version: ${target}`);
    if (identity && JSON.stringify(current) !== JSON.stringify(identity))
      throw new Error(`Release identity differs: ${target}`);
    identity = current;
    if (
      !manifest.assets.some((asset) => asset.name.startsWith(`${manifest.releaseName}-${target}.`))
    )
      throw new Error(`Installer target differs: ${target}`);
    for (const asset of manifest.assets) {
      if (seen.has(asset.name)) throw new Error(`Release asset collision: ${asset.name}`);
      seen.add(asset.name);
      await copyFile(join(directory, asset.name), join(output, asset.name));
    }
  }
  return createReleaseManifest(output, identity);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = resolve(process.argv[3] ?? "releases/ci-combined");
  let expectedIdentity;
  if (process.env.GITHUB_ACTIONS === "true") {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    if (!pkg.app2meRelease?.date || !pkg.app2meRelease?.windowsBuildVersion)
      throw new Error("Missing prepared release version");
    expectedIdentity = {
      releaseName: `app2me-${pkg.app2meRelease.date}`,
      date: pkg.app2meRelease.date,
      appVersion: pkg.version,
      windowsBuildVersion: pkg.app2meRelease.windowsBuildVersion,
    };
  }
  await assembleRelease(
    resolve(process.argv[2] ?? "releases/ci-input"),
    output,
    releaseTargets,
    expectedIdentity,
  );
  if (process.argv.includes("--publish")) console.log(await publishRelease(output));
}
