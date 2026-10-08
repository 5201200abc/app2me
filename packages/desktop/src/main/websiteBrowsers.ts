import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { WebsiteBrowserInfo } from "@mycode/shared";

const run = promisify(execFile);

export function websiteBrowserCandidates(platform: string, env: NodeJS.ProcessEnv) {
  if (platform === "darwin")
    return [
      {
        id: "chrome" as const,
        name: "Chrome",
        paths: [
          "/Applications/Google Chrome.app",
          join(env.HOME ?? "", "Applications/Google Chrome.app"),
        ],
      },
      {
        id: "safari" as const,
        name: "Safari",
        paths: ["/Applications/Safari.app", "/System/Applications/Safari.app"],
      },
    ];
  return [
    {
      id: "chrome" as const,
      name: "Chrome",
      paths:
        platform === "win32"
          ? [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
              .filter((root): root is string => Boolean(root))
              .map((root) => join(root, "Google/Chrome/Application/chrome.exe"))
          : [
              "/usr/bin/google-chrome",
              "/usr/bin/google-chrome-stable",
              "/opt/google/chrome/chrome",
            ],
    },
  ];
}

async function installedBrowsers() {
  const installed = await Promise.all(
    websiteBrowserCandidates(process.platform, process.env).map(async (browser) => {
      for (const path of browser.paths) {
        try {
          await access(path, constants.F_OK);
          return { ...browser, path };
        } catch {
          /* 未安装的应用不进入菜单。 */
        }
      }
      return null;
    }),
  );
  return installed.filter((browser) => browser !== null);
}

export async function getWebsiteBrowsers(): Promise<WebsiteBrowserInfo[]> {
  return (await installedBrowsers()).map(({ id, name }) => ({ id, name }));
}

export async function openWebsiteBrowser(browserId: unknown, value: unknown) {
  if ((browserId !== "chrome" && browserId !== "safari") || typeof value !== "string")
    return { success: false, error: "Invalid browser request" };
  try {
    const url = new URL(value);
    if (!["http:", "https:", "file:"].includes(url.protocol)) throw new Error("Unsupported URL");
    const browser = (await installedBrowsers()).find((item) => item.id === browserId);
    if (!browser) throw new Error("Browser unavailable");
    // 显式浏览器入口不再交给系统默认 App；参数数组避免路径和 URL 被 shell 解释。
    if (process.platform === "darwin") await run("/usr/bin/open", ["-a", browser.path, url.href]);
    else {
      const child = spawn(browser.path, [url.href], {
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
