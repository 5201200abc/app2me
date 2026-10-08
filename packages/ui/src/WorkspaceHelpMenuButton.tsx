import {
  DesktopCommandIds,
  TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
  TID_WORKSPACE_HELP_MENU_TRIGGER,
} from "@mycode/shared";
import {
  ActivityIcon,
  BookOpenIcon,
  Help,
  InfoIcon,
  RefreshCwIcon,
} from "@/components/icons/tabler.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useDesktopUpdateMenu } from "@/hooks/useDesktopUpdateMenu.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { createHelpMenuActionHandlers } from "@/lib/helpMenuActions.js";

export function WorkspaceHelpMenuButton({
  className,
  isDesktop = false,
  presentation = "button",
}: {
  className?: string;
  presentation?: "button" | "submenu";
  /**
   * 是否桌面端。由挂载处注入而不是在组件内嗅探：Web 的 IPlatformService 桩同样实现了
   * executeDesktopCommand（no-op），拿它判定会让 Web 端出现一个点了没反应的「资源管理器」。
   */
  isDesktop?: boolean;
}) {
  const { intl } = useMyCodeIntl();
  const platform = usePlatform();
  const updateMenu = useDesktopUpdateMenu(isDesktop);
  const helpMenuLabel = intl.formatMessage({ id: "workspaceHeader.help.menu" });
  const helpMenuActions = createHelpMenuActionHandlers({
    platform,
    intl,
  });
  const handleOpenResourceManager = () => {
    void platform.executeDesktopCommand(DesktopCommandIds.OpenResourceManager);
  };

  const handleShowAbout = () => {
    void platform.executeDesktopCommand(DesktopCommandIds.ShowAbout);
  };

  const items = (
    <>
      <DropdownMenuItem onSelect={helpMenuActions.openProductDocs}>
        <BookOpenIcon className="size-4" />
        {intl.formatMessage({ id: "workspaceHeader.help.docs" })}
      </DropdownMenuItem>
      {/* Windows/Linux 没有原生菜单栏，自绘标题栏箭头菜单也已下线，
            资源管理器只能从这里进；Web 端没有该窗口，不渲染。 */}
      {isDesktop ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid={TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER}
            onSelect={handleOpenResourceManager}
          >
            <ActivityIcon className="size-4" />
            {intl.formatMessage({ id: "titleBar.menu.help.resourceManager" })}
          </DropdownMenuItem>
          {updateMenu.visible ? (
            <DropdownMenuItem disabled={updateMenu.disabled} onSelect={updateMenu.checkForUpdates}>
              <RefreshCwIcon className="size-4" />
              {updateMenu.labelId === "desktopMenu.help.restartToUpdate" ? (
                <>
                  <span className="whitespace-nowrap">
                    {intl.formatMessage({ id: "desktopMenu.help.restartUpdateAction" })}
                  </span>
                  <Badge variant="secondary" className="h-4 px-1.5 py-0 bg-success/10 text-success">
                    {updateMenu.labelValues?.version}
                  </Badge>
                </>
              ) : (
                intl.formatMessage({ id: updateMenu.labelId }, updateMenu.labelValues)
              )}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={handleShowAbout}>
            <InfoIcon className="size-4" />
            {intl.formatMessage({ id: "titleBar.menu.help.about" })}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
  if (presentation === "submenu")
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid={TID_WORKSPACE_HELP_MENU_TRIGGER}>
          <Help className="size-3.5" strokeWidth={1.5} />
          {helpMenuLabel}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="workspace-preferences-menu w-44 rounded-xl p-1 shadow-xs">
          {items}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  return (
    <DropdownMenu>
      <ControlHintTooltip title={helpMenuLabel} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            className={cn(
              "size-7 text-foreground-subtle hover:bg-hover hover:text-foreground [app-region:no-drag]",
              className,
            )}
            aria-label={helpMenuLabel}
            data-testid={TID_WORKSPACE_HELP_MENU_TRIGGER}
          >
            <Help className="size-3.5" strokeWidth={1.5} />
          </Button>
        </DropdownMenuTrigger>
      </ControlHintTooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        className="workspace-help-menu w-44 min-w-44 max-w-[calc(100vw-1rem)] rounded-xl p-1 shadow-xs [&_[data-slot=dropdown-menu-item]]:min-h-7 [&_[data-slot=dropdown-menu-item]]:gap-2 [&_[data-slot=dropdown-menu-item]]:py-1 [&_[data-slot=dropdown-menu-item]]:text-ui-caption [&_svg]:size-3.5 [&_svg]:stroke-[1.5]"
      >
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
