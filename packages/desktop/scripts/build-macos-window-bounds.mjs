#!/usr/bin/env node
// 编译 macOS 窗口 bounds 辅助程序（CUA 权限浮窗的吸附数据源）。
//
// 非 darwin 直接跳过：这个二进制只服务 macOS 的 TCC 授权引导，其他平台没有对应流程。
// 缺少 swiftc（未装 Xcode CLT）时也只警告不失败 —— 吸附是观感增强，拿不到 bounds 时浮窗
// 会 fail-open 到屏幕底部照样可用，不该因此让整个 desktop 构建挂掉。

import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "native", "macos-window-bounds", "main.swift");
const outputDir = join(packageRoot, "resources", "macos-window-bounds");
const outputPath = join(outputDir, "mycode-window-bounds");

if (process.platform !== "darwin") {
  console.log("[window-bounds] 跳过：仅 macOS 需要");
  process.exit(0);
}

try {
  await access(sourcePath);
} catch {
  console.error(`[window-bounds] 源文件缺失：${sourcePath}`);
  process.exit(1);
}

async function hasSwiftc() {
  try {
    await run("xcrun", ["--find", "swiftc"]);
    return true;
  } catch {
    return false;
  }
}

if (!(await hasSwiftc())) {
  console.warn("[window-bounds] 未找到 swiftc（需 Xcode Command Line Tools）；跳过构建。");
  console.warn("[window-bounds] 权限浮窗仍可用，但不会吸附到系统设置窗口。");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

try {
  // 安装包已按架构分发；强制 universal 会因本机 CLT 缺 x86_64 链接库而丢掉整个 helper。
  const target = process.env.MYCODE_TARGET_ARCH ?? process.arch;
  if (!["arm64", "x64"].includes(target))
    throw new Error(`Unsupported macOS architecture: ${target}`);
  const swiftArch = target === "x64" ? "x86_64" : "arm64";
  await run("xcrun", [
    "swiftc",
    "-O",
    "-target",
    `${swiftArch}-apple-macos11`,
    sourcePath,
    "-o",
    outputPath,
  ]);
  await rm(`${outputPath}-arm64`, { force: true });
  await rm(`${outputPath}-x86_64`, { force: true });
  console.log(`[window-bounds] 已构建 ${target} 二进制：${outputPath}`);
} catch (error) {
  console.warn(
    "[window-bounds] 构建失败；权限浮窗仍可用但不会吸附：",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(0);
}
