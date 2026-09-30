import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// 根目录 hoisted 安装不会给嵌套 workspace 创建 .bin/turbo；Node 解析能沿目录找到同一份已声明依赖。
const require = createRequire(import.meta.url);
const executable = require.resolve("turbo/bin/turbo");
const child = spawn(process.execPath, [executable, "--skip-infer", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
