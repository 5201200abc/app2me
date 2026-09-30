import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { app, systemPreferences } from "electron";
import { createCuaDriverHost } from "./cuaDriverHost.js";

const execFileAsync = promisify(execFile);

function packagedSdkEntry(entry: "electron" | "embedded") {
  return pathToFileURL(
    join(
      dirname(app.getAppPath()),
      `app.asar.unpacked/node_modules/@trycua/cua-driver/dist/${entry}.js`,
    ),
  ).href;
}

export async function requestDesktopCuaPermissions() {
  if (process.platform !== "darwin") return { accessibility: true, screenRecording: true };
  const { requestMacOSPermissions } = app.isPackaged
    ? ((await import(packagedSdkEntry("electron"))) as typeof import("@trycua/cua-driver/electron"))
    : await import("@trycua/cua-driver/electron");
  // 仅打开设置不会把应用登记到屏幕录制列表；必须由 Main 调用上游原生请求接口。
  return requestMacOSPermissions();
}

export function createDesktopCuaDriver() {
  return createCuaDriverHost({
    grantOwner: app.getName(),
    permissions(request) {
      if (process.platform !== "darwin") return { accessibility: true, screenRecording: true };
      if (request) return requestDesktopCuaPermissions();
      return {
        accessibility: systemPreferences.isTrustedAccessibilityClient(false),
        screenRecording: systemPreferences.getMediaAccessStatus("screen") === "granted",
      };
    },
    async loadDriver() {
      if (process.platform !== "darwin" && process.platform !== "win32") {
        throw new Error("Cua Driver is enabled only on local macOS and Windows desktops");
      }
      const binaryName = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
      const binary = app.isPackaged
        ? join(process.resourcesPath, "cua-driver", binaryName)
        : resolve(
            import.meta.dirname,
            "../../bundled-tools",
            `${process.platform}-${process.arch}`,
            "cua-driver",
            binaryName,
          );
      await access(binary);
      let bundleId = "dev.mycode.app";
      if (process.platform === "darwin") {
        const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleIdentifier",
          join(dirname(dirname(app.getPath("exe"))), "Info.plist"),
        ]);
        bundleId = stdout.trim();
        if (!bundleId) throw new Error("MyCode bundle identifier is unavailable");
      }
      // 保持 SDK/FFI 为外部依赖；内联生成绑定会改变 native library 的相对解析目录。
      const { EmbeddedCuaDriverHost } = app.isPackaged
        ? ((await import(
            packagedSdkEntry("embedded")
          )) as typeof import("@trycua/cua-driver/embedded"))
        : await import("@trycua/cua-driver/embedded");
      return new EmbeddedCuaDriverHost(binary, bundleId);
    },
  });
}
