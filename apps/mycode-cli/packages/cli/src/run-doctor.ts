import { getRuntimeInfo } from "@mycode/core";
import { color, formatJson, supportsColor } from "@mycode/core";

import type { RunContext, GlobalOptions } from "@mycode/shared-types";

import { CLI_COMMAND_NAME, CLI_PROCESS_NAME } from "./process-name.js";

export function runDoctor(
  ctx: RunContext,
  options: GlobalOptions,
  workingDirectory: string,
  version: string,
): number {
  const runtime = getRuntimeInfo();
  const payload = {
    cli: {
      name: CLI_COMMAND_NAME,
      processName: CLI_PROCESS_NAME,
      version,
    },
    runtime: {
      arch: runtime.arch,
      cwd: workingDirectory,
      execPath: runtime.execPath,
      node: runtime.node,
      platform: runtime.platform,
      processTitle: process.title,
      sea: runtime.sea,
    },
    packaging: {
      default: "node-bundle",
      sea: "optional",
    },
  };

  if (options.json) {
    ctx.stdout.write(formatJson(payload));
    return 0;
  }

  const colors = supportsColor(ctx.stdout, options.noColor);
  ctx.stdout.write(`${color.bold("mycode doctor", colors)}\n`);
  ctx.stdout.write(`version: ${payload.cli.version}\n`);
  ctx.stdout.write(`process: ${payload.runtime.processTitle}\n`);
  ctx.stdout.write(`node: ${payload.runtime.node}\n`);
  ctx.stdout.write(`platform: ${payload.runtime.platform}/${payload.runtime.arch}\n`);
  ctx.stdout.write(`sea: ${payload.runtime.sea ? "yes" : "no"} (${payload.packaging.sea})\n`);
  ctx.stdout.write(`default artifact: ${payload.packaging.default}\n`);

  if (options.verbose) {
    ctx.stdout.write(`execPath: ${payload.runtime.execPath}\n`);
    ctx.stdout.write(`cwd: ${payload.runtime.cwd}\n`);
  }

  return 0;
}
