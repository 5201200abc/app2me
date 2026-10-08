import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { originalTarMembers } from "./license-publisher-reviews.mjs";

const execute = promisify(execFile);
export async function buildWindowsRipgrep(artifact, plan, run = execute) {
  if (plan.platform !== "win32" || !["x64", "arm64"].includes(plan.arch))
    throw new Error("Unsupported Windows ripgrep build target");
  const target = `${plan.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`;
  const directory = await mkdtemp(join(tmpdir(), "app2me-ripgrep-"));
  const options = {
    cwd: directory,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PCRE2_SYS_STATIC: "1",
      CC: "cl",
      AR: "lib",
      CARGO_ENCODED_RUSTFLAGS: "-C\x1ftarget-feature=+crt-static",
    },
  };
  try {
    const prefix = `ripgrep-${artifact.sourceRevision}/`;
    for (const [path, bytes] of originalTarMembers(await readFile(artifact.archivePath), {
      skipSymbolicLinks: true,
    })) {
      if (!path.startsWith(prefix)) throw new Error("Unexpected ripgrep archive root");
      const member = path.slice(prefix.length);
      if (
        !member ||
        member.includes("\\") ||
        member.includes(":") ||
        member.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Unsafe ripgrep archive member");
      const output = join(directory, member);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }
    await run(
      "rustup",
      ["toolchain", "install", artifact.toolchain, "--profile", "minimal", "--target", target],
      options,
    );
    const { stdout } = await run(
      "rustup",
      ["run", artifact.toolchain, "rustc", "--version", "--verbose"],
      options,
    );
    // 专用源中的未知 Rust 修订无法核验；只允许已留存原始许可的官方编译器。
    if (!stdout.includes(`commit-hash: ${artifact.compilerRevision}`))
      throw new Error("Windows ripgrep compiler revision differs from reviewed source");
    await run(
      "rustup",
      [
        "run",
        artifact.toolchain,
        "cargo",
        "build",
        "--release",
        "--locked",
        "--features",
        "pcre2",
        "--target",
        target,
      ],
      options,
    );
    await mkdir(dirname(artifact.binaryPath), { recursive: true });
    await copyFile(join(directory, "target", target, "release", "rg.exe"), artifact.binaryPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
