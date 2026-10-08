import { useMemo, useState } from "react";
import type { Settings } from "@mycode/shared/mychat";
import { useMyChatApi } from "@/hooks/useMyChatApi.js";
import { useMyCodeStore } from "@/store/StoreProvider.js";
import { WorkspaceSidebarFooter } from "@/WorkspaceSidebarFooter.js";
import { MyChatApiContext } from "./MyChatApiContext.js";
import { App } from "./chat/App.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";
import "./chat/styles.css";
import "./desktop.css";
import { DesktopWindowFrame } from "@/DesktopWindowFrame.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useAppChromeState } from "@/app-shell/useAppChromeState.js";
import { resolveWorkspaceShellWindowChromeClass } from "@/app-shell/workspaceShellWindowChrome.js";

export default function MyChatWorkspace({
  active,
  workspacePath,
  workspaceIdentity,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
}: {
  active: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
}) {
  const api = useMyChatApi(active);
  const platform = usePlatform();
  const chrome = useAppChromeState({
    isDesktop,
    isMacDesktop,
    isWindowsDesktop,
    platform,
    workspaceAbsPath: workspacePath,
  });
  const [usageOpen, setUsageOpen] = useState(false);
  const theme = useMyCodeStore((state) => state.theme);
  const fontSize = useMyCodeStore((state) => state.uiFontSizePx);
  const locale = useMyCodeStore((state) => state.locale);
  const setLocale = useMyCodeStore((state) => state.setLocale);
  const setTheme = useMyCodeStore((state) => state.setTheme);
  const preferences = useMemo<Pick<Settings, "theme" | "fontSize">>(
    () => ({
      theme: theme === "system" ? "system" : theme.endsWith("dark") ? "dark" : "light",
      fontSize: fontSize as Settings["fontSize"],
    }),
    [theme, fontSize],
  );
  return (
    <MyChatApiContext.Provider value={api}>
      <DesktopWindowFrame
        title="MyChat"
        isDesktop={isDesktop}
        isMacDesktop={isMacDesktop}
        isWindowsDesktop={isWindowsDesktop}
      >
        <div
          className="mychat-surface"
          data-mychat-dark={preferences.theme === "dark" ? "true" : undefined}
          data-interface-mode="mychat"
        >
          <App
            active={active}
            chromeOptions={{
              workspacePath,
              isDesktop,
              isMacDesktop,
              isWindowsDesktop,
              platform,
              chrome,
              frameClassName: resolveWorkspaceShellWindowChromeClass({
                isMacDesktop,
                isWindowsDesktop,
                isLinuxDesktop: Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop),
                macOSMajorVersion: chrome.desktopWindowChromeState?.macOSMajorVersion,
                isWindowsMaximized: chrome.desktopWindowChromeState?.isMaximized ?? false,
                supportsNativeRoundedCorners:
                  chrome.desktopWindowChromeState?.supportsNativeRoundedCorners ?? null,
              }),
            }}
            sharedPreferences={preferences}
            footer={(openSettings) => (
              <WorkspaceSidebarFooter
                workspacePath={workspacePath}
                workspaceIdentity={workspaceIdentity}
                theme={theme}
                localeMenuValue={locale as "zh-CN" | "en-US"}
                onLocaleChange={setLocale}
                onThemeChange={(value) => {
                  if (value === "system" || value === "mycode-dark" || value === "mycode-light")
                    setTheme(value);
                }}
                onSettingsButtonClick={openSettings}
                onUsageClick={() => setUsageOpen(true)}
                isDesktop={isDesktop}
              />
            )}
          />
        </div>
      </DesktopWindowFrame>
      <Dialog open={active && usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogTitle>{locale === "en-US" ? "Usage statistics" : "使用统计"}</DialogTitle>
          <AppUsagePanel />
        </DialogContent>
      </Dialog>
    </MyChatApiContext.Provider>
  );
}
