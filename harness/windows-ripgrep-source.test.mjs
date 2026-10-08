import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWindowsRipgrep } from "../scripts/build-windows-ripgrep.mjs";
import { resolveNativeSearchPrebuiltPlan } from "../scripts/native-search-tools-config.mjs";

for (const arch of ["x64", "arm64"]) {
  test(`Windows ${arch} ripgrep uses reviewed source and compiler with static PCRE2`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "app2me-windows-ripgrep-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const plan = resolveNativeSearchPrebuiltPlan({ platform: "win32", arch, outputDir: directory });
    const artifact = plan.artifacts.find((item) => item.toolId === "ripgrep");
    assert.equal(artifact.source, "source-build");
    assert.equal(artifact.toolchain, "1.88.0");
    const calls = [];
    await buildWindowsRipgrep(artifact, plan, async (command, args, options) => {
      calls.push([command, args]);
      assert.equal(options.env.PCRE2_SYS_STATIC, "1");
      assert.match(await readFile(join(options.cwd, "Cargo.toml"), "utf8"), /name = "ripgrep"/);
      assert.match(await readFile(join(options.cwd, "Cargo.lock"), "utf8"), /name = "pcre2-sys"/);
      if (args.includes("--verbose"))
        return { stdout: `commit-hash: ${artifact.compilerRevision}` };
      if (args.includes("build")) {
        const target = args.at(-1);
        assert.equal(target, `${arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`);
        assert.ok(args.includes("--locked"));
        assert.equal(args[args.indexOf("--features") + 1], "pcre2");
        await mkdir(join(options.cwd, "target", target, "release"), { recursive: true });
        await writeFile(join(options.cwd, "target", target, "release", "rg.exe"), "fixture");
      }
      return { stdout: "" };
    });
    assert.equal(calls.length, 3);
    assert.equal(await readFile(artifact.binaryPath, "utf8"), "fixture");
    await assert.rejects(
      buildWindowsRipgrep(artifact, plan, async () => ({ stdout: "commit-hash: unknown" })),
      /compiler revision differs/,
    );
  });
}
