import { useMyCodeStoreWithDefault } from "@/store/StoreProvider.js";
/* oxlint-disable eslint(max-lines) -- footer 聚合账户、主题、模式和快捷键菜单。 */
import type { Locale, UserInfo } from "@mycode/shared";
import { memo, useCallback, useEffect, useState } from "react";
import {
  DesktopCommandIds,
  TID_TASK_SETTINGS_BUTTON,
  DESKTOP_ZOOM_MIN_LEVEL,
  DESKTOP_ZOOM_MAX_LEVEL,
} from "@mycode/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  BarChart3,
  Globe,
  Maximize,
  PanelsTopLeft,
  Palette,
  Settings,
  User,
  ZoomIn,
  ZoomOut,
} from "@/components/icons/tabler.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import type { Theme } from "@/useTheme.js";
import { WorkspaceWebRemoteControlTrigger } from "@/WorkspaceWebRemoteControlTrigger.js";
import { WorkspaceHelpMenuButton } from "@/WorkspaceHelpMenuButton.js";

export const WorkspaceSidebarFooter = memo(function WorkspaceSidebarFooterComponent({
  workspacePath,
  workspaceIdentity,
  theme,
  localeMenuValue,
  onLocaleChange,
  onThemeChange,
  onSettingsButtonClick,
  onUsageClick,
  settingsButtonMode = "settings",
  isDesktop = false,
  className,
}: {
  theme: Theme;
  localeMenuValue: Locale | "system";
  onLocaleChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onSettingsButtonClick?: () => void;
  onUsageClick?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  settingsButtonMode?: "settings" | "back";
  user?: UserInfo | null;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activeTaskId?: string | null;
  isDesktop?: boolean;
  className?: string;
}) {
  const { intl } = useMyCodeIntl();
  const interfaceMode = useMyCodeStoreWithDefault((state) => state.interfaceMode, "mycode");
  const setInterfaceMode = useMyCodeStoreWithDefault((state) => state.setInterfaceMode, undefined);
  const modeLabel = interfaceMode === "mychat" ? "MyChat" : "MyCode";
  const platform = usePlatform();
  const zoomInShortcutLabel = useShortcutCommandLabel("zoomIn");
  const zoomOutShortcutLabel = useShortcutCommandLabel("zoomOut");
  const resetZoomShortcutLabel = useShortcutCommandLabel("resetZoom");
  const profileContent = (
    <>
      <Avatar size="sm" className="data-[size=sm]:size-5.5">
        <AvatarFallback className="bg-surface text-foreground-subtle">
          <User className="size-3" strokeWidth={1.5} />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 overflow-hidden text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-caption font-medium text-foreground-subtle">
            {modeLabel}
          </span>
        </div>
      </div>
    </>
  );
  const settingsButtonLabel =
    settingsButtonMode === "back"
      ? intl.formatMessage({ id: "workspace.backToWorkspace" })
      : intl.formatMessage({ id: "settings.title" });
  const usageButtonClick = onUsageClick ?? onSettingsButtonClick;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [desktopZoomLevel, setDesktopZoomLevel] = useState(0);
  const runDesktopZoomCommand = useCallback(
    (command: (typeof DesktopCommandIds)["ZoomIn" | "ZoomOut" | "ResetZoom"]) => {
      void platform.executeDesktopCommand(command);
    },
    [platform],
  );

  useEffect(() => {
    if (!isDesktop) {
      setDesktopZoomLevel(0);
      return;
    }

    let isCancelled = false;
    void platform.getDesktopZoomLevel?.().then((state) => {
      if (!isCancelled && Number.isFinite(state.zoomLevel)) {
        setDesktopZoomLevel(state.zoomLevel);
      }
    });

    const dispose = platform.onDesktopZoomLevelChanged?.((state) => {
      if (Number.isFinite(state.zoomLevel)) {
        setDesktopZoomLevel(state.zoomLevel);
      }
    });

    return () => {
      isCancelled = true;
      dispose?.();
    };
  }, [isDesktop, platform]);

  const canResetDesktopZoom = desktopZoomLevel !== 0;
  const canZoomIn = desktopZoomLevel < DESKTOP_ZOOM_MAX_LEVEL;
  const canZoomOut = desktopZoomLevel > DESKTOP_ZOOM_MIN_LEVEL;

  return (
    // footer 被 Settings 复用，页面专属边距由调用方传入，避免修改共享默认样式。
    <footer
      className={cn(
        "workspace-sidebar-footer flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
          <DropdownMenuTrigger asChild>
            {/* 旧账号已退役，头像只承载应用偏好和本地使用统计。 */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-1.5 overflow-hidden rounded-lg border-0 px-1"
              aria-label={modeLabel}
            >
              {/* Button 默认 shrink-0 且带 whitespace-nowrap，超长用户名会把 footer 撑出 sidebar。
                这里让触发按钮和文本列都允许收缩，并只在用户名自身做单行截断。 */}
              {profileContent}
            </Button>
          </DropdownMenuTrigger>
          {/* 菜单内容保持挂载，避免每次点击头像菜单都重建 footer 内部状态。*/}
          <DropdownMenuContent
            align="start"
            className="workspace-preferences-menu w-44 min-w-44 rounded-xl p-1 shadow-xs"
            forceMount
          >
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Globe className="size-4" />
                {intl.formatMessage({ id: "sidebar.settings.languageSettings" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="workspace-preferences-menu w-44 rounded-xl p-1 shadow-xs">
                <DropdownMenuRadioGroup value={localeMenuValue} onValueChange={onLocaleChange}>
                  <DropdownMenuRadioItem value="system">
                    {intl.formatMessage({
                      id: "sidebar.settings.systemDefault",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en-US">
                    {intl.formatMessage({
                      id: "sidebar.settings.locale.en-US",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zh-CN">
                    {intl.formatMessage({
                      id: "sidebar.settings.locale.zh-CN",
                    })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="size-4" />
                {intl.formatMessage({ id: "sidebar.settings.themeAppearance" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="workspace-preferences-menu w-44 rounded-xl p-1 shadow-xs">
                <DropdownMenuRadioGroup value={theme} onValueChange={onThemeChange}>
                  <DropdownMenuRadioItem value="system">
                    {intl.formatMessage({
                      id: "sidebar.settings.systemDefault",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="mycode-dark">
                    {intl.formatMessage({
                      id: "sidebar.settings.theme.mycode-dark",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="mycode-light">
                    {intl.formatMessage({
                      id: "sidebar.settings.theme.mycode-light",
                    })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* 快捷键设置：缩放子菜单 label 读生效表，设置页改绑后即时跟随 */}
            {isDesktop ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ZoomIn className="size-4" />
                  {intl.formatMessage({ id: "sidebar.settings.interfaceZoom" })}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="workspace-preferences-menu w-48 rounded-xl p-1 shadow-xs">
                  <DropdownMenuItem
                    disabled={!canZoomIn}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ZoomIn)}
                  >
                    <ZoomIn className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.zoomIn" })}
                    <DropdownMenuShortcut>{zoomInShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canZoomOut}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ZoomOut)}
                  >
                    <ZoomOut className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.zoomOut" })}
                    <DropdownMenuShortcut>{zoomOutShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canResetDesktopZoom}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ResetZoom)}
                  >
                    <Maximize className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.actualSize" })}
                    <DropdownMenuShortcut>{resetZoomShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PanelsTopLeft className="size-4" />
                {intl.formatMessage({ id: "sidebar.settings.layoutMode" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="workspace-preferences-menu w-40 rounded-xl p-1 shadow-xs">
                <DropdownMenuRadioGroup
                  value={interfaceMode}
                  onValueChange={(value) => {
                    if (value === "mycode" || value === "mychat") setInterfaceMode?.(value);
                  }}
                >
                  <DropdownMenuRadioItem value="mychat">MyChat</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="mycode">MyCode</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={usageButtonClick}>
              <BarChart3 className="size-3.5" strokeWidth={1.5} />
              {intl.formatMessage({ id: "settings.usageTitle" })}
            </DropdownMenuItem>
            <WorkspaceHelpMenuButton isDesktop={isDesktop} presentation="submenu" />
            <DropdownMenuItem
              data-testid={TID_TASK_SETTINGS_BUTTON}
              disabled={!onSettingsButtonClick}
              onSelect={onSettingsButtonClick}
            >
              <Settings className="size-3.5" strokeWidth={1.5} />
              {settingsButtonLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex shrink-0 items-center gap-0.5 [&_button]:size-6.5 [&_svg]:size-4 [&_svg]:stroke-[1.5]">
          {isDesktop && workspacePath ? (
            <WorkspaceWebRemoteControlTrigger
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              compact
              className="size-7 text-foreground-subtle"
            />
          ) : null}
        </div>
      </div>
    </footer>
  );
});
