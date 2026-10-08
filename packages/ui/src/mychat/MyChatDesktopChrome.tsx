import type { CSSProperties } from "react";
import type { IPlatformService } from "@mycode/shared";
import { DesktopTopOverlay } from "@/DesktopTopOverlay.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import type { useAppChromeState } from "@/app-shell/useAppChromeState.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import appLogoUrl from "@/assets/mycode-mark.png";

export interface MyChatChromeOptions {
  workspacePath: string;
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  frameClassName: string;
  platform: IPlatformService;
  chrome: ReturnType<typeof useAppChromeState>;
}

export function MyChatDesktopChrome({
  options,
  sidebarOpen,
  sidebarWidth,
  onToggleSidebar,
  onNew,
  onSettings,
  onSearch,
}: {
  options: MyChatChromeOptions;
  sidebarOpen: boolean;
  sidebarWidth: number;
  onToggleSidebar: () => void;
  onNew: () => void;
  onSettings: () => void;
  onSearch: () => void;
}) {
  const toggle = useShortcutCommandLabel("toggleSidebar");
  const newTask = useShortcutCommandLabel("newTask");
  const back = useShortcutCommandLabel("navigateBack");
  const forward = useShortcutCommandLabel("navigateForward");
  const search = useShortcutCommandLabel("openCommandCenter");
  return (
    <div style={{ "--workspace-sidebar-panel-width": `${sidebarWidth}px` } as CSSProperties}>
      <DesktopTopOverlay
        workspaceAbsPath={options.workspacePath}
        isDesktop={options.isDesktop}
        isMacDesktop={options.isMacDesktop}
        isWindowsDesktop={options.isWindowsDesktop}
        isMacFullscreen={options.chrome.isMacFullscreen}
        macWindowControlsLeftPaddingPx={options.chrome.macWindowControlsLeftPaddingPx}
        windowsWindowControlsRightPaddingPx={options.chrome.windowsWindowControlsRightPaddingPx}
        isSidebarVisible={sidebarOpen}
        showNewTaskButton={false}
        updateReadyVersion={options.chrome.updateReadyVersion}
        updateState={options.chrome.updateState}
        toggleSidebarShortcutLabel={toggle}
        newTaskShortcutLabel={newTask}
        goBackShortcutLabel={back}
        goForwardShortcutLabel={forward}
        canTaskNavBack={false}
        canTaskNavForward={false}
        canGoBack={false}
        canGoForward={false}
        appLogoUrl={appLogoUrl}
        platform={options.platform}
        onToggleSidebar={onToggleSidebar}
        onCreateTask={onNew}
        onGoBack={() => {}}
        onGoForward={() => {}}
        onOpenSettings={onSettings}
        onOpenSearch={onSearch}
        searchShortcutLabel={search}
      />
      {options.isDesktop && !options.isMacDesktop ? (
        <div className="absolute right-2 top-2 z-30">
          <DesktopWindowControls />
        </div>
      ) : null}
    </div>
  );
}
