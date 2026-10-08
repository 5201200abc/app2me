import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, join } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { MYCODE_VERSION, type DesktopToolEnvironment } from "@mycode/shared";
import { findMyCodeAgentRuntimeNodeBundle } from "@mycode/services/node";

const run = promisify(execFile);
export async function getDesktopToolEnvironment(): Promise<DesktopToolEnvironment> {
  let gitPath: string | null = null;
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, process.platform === "win32" ? "git.exe" : "git");
    try {
      await access(candidate, constants.X_OK);
      gitPath = candidate;
      break;
    } catch {
      /* 仅展示实际可用路径。 */
    }
  }
  const gitVersion = gitPath
    ? await run(gitPath, ["--version"], { timeout: 5000 })
        .then(({ stdout }) => stdout.trim())
        .catch(() => null)
    : null;
  const bundle = findMyCodeAgentRuntimeNodeBundle();
  return {
    gitPath,
    gitVersion,
    nodePath: process.execPath,
    nodeVersion: process.versions.node,
    bundleVersion: MYCODE_VERSION,
    bundledPaths: bundle ? [bundle] : [],
  };
}
