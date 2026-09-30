import { execFile } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "apps/mycode-cli");
const output = resolve(
  process.argv[2] || join(root, ".artifacts/mycode-followup/cli-lint-current.json"),
);
const results = [];
for (const name of await readdir(join(cli, "packages"))) {
  const cwd = join(cli, "packages", name);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
    throw error;
  }
  if (!pkg.scripts?.lint?.startsWith("oxlint src")) continue;
  const args = ["src", "--format", "json"];
  if (pkg.scripts.lint.includes("--no-ignore")) args.push("--no-ignore");
  const executable = process.execPath;
  args.unshift(join(cli, "node_modules/oxlint/bin/oxlint"));
  let result;
  try {
    result = await run(executable, args, { cwd, encoding: "utf8", maxBuffer: 10_000_000 });
  } catch (error) {
    if (error.code !== 1 || !error.stdout) throw error;
    result = error;
  }
  results.push({ package: name, ...JSON.parse(result.stdout) });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(results, null, 2));
const errors = results.flatMap((pkg) =>
  pkg.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => ({
      package: pkg.package,
      file: item.filename,
      code: item.code,
      message: item.message,
    })),
);
console.log(
  JSON.stringify({ packages: results.length, errors: errors.length, items: errors }, null, 2),
);
process.exitCode = errors.length ? 1 : 0;
