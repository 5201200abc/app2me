import { app } from "electron";
import { fileURLToPath } from "node:url";
import {
  consumeDevLaunchEnvironment,
  connectDevLaunchOwner,
} from "./scripts/devElectronLaunch.mjs";

// Main 的静态依赖会读取环境；先异步准备，再 import，避免并行模块求值抢先读取旧环境。
const launch = await consumeDevLaunchEnvironment(process.argv);
Object.assign(process.env, launch.env);
let stopping = false;
await connectDevLaunchOwner(launch, () => {
  if (stopping) return;
  stopping = true;
  void app.whenReady().then(() => app.quit());
});
// 深链接的 defaultApp 入口不能指向一次性的环境文件 wrapper。
process.argv.splice(1, process.argv.length - 1, fileURLToPath(new URL(".", import.meta.url)));
await import("./out/main/index.js");
