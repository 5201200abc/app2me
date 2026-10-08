import { ChevronDown, Cloud, Folder, Monitor } from "@/components/icons/tabler.js";
import { testId } from "@mycode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { isPluginScopeWorkspaceSelectable } from "@/lib/pluginScopeWorkspaces.js";
export { isPluginScopeWorkspaceConnected } from "@/lib/pluginScopeWorkspaces.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export function getPluginWorkspaceKey(tab: WorkspaceTabState): string {
  return getWorkspaceKey(tab.workspacePath, tab.workspaceIdentity);
}

export function PluginScopeMenu({
  align = "start",
  disabled = false,
  includeUser = true,
  selectedScopeKey,
  triggerIconTestId,
  triggerTestId,
  userOptionTestId,
  workspaceOptionTestIdPrefix,
  workspaceOptions,
  workspaceTabs = [],
  onScopeKeyChange,
}: {
  align?: "start" | "center" | "end";
  disabled?: boolean;
  includeUser?: boolean;
  selectedScopeKey: string;
  triggerIconTestId?: string;
  triggerTestId?: string;
  userOptionTestId?: string;
  workspaceOptionTestIdPrefix?: string;
  workspaceOptions?: Array<{ key: string; label: string; remote?: boolean }>;
  workspaceTabs?: WorkspaceTabState[];
  onScopeKeyChange: (scopeKey: string) => void;
}) {
  const { intl } = useMyCodeIntl();
  const scopeWorkspaces =
    workspaceOptions ??
    workspaceTabs.filter(isPluginScopeWorkspaceSelectable).map((tab) => ({
      key: getPluginWorkspaceKey(tab),
      label: tab.label,
      remote: Boolean(tab.remoteTarget || tab.remoteSessionId),
    }));
  const selectedWorkspace = scopeWorkspaces.find((workspace) => workspace.key === selectedScopeKey);
  const SelectedWorkspaceIcon = selectedWorkspace?.remote ? Cloud : Folder;
  // 用户作用域是本机配置范围，不能使用登录账号或设备用户名代替其语义。
  const userLabel = intl.formatMessage({ id: "settings.plugin.scope.user" });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size="default"
          data-testid={triggerTestId}
          data-plugin-scope-trigger="true"
          data-plugin-scope-key={selectedScopeKey}
          className="gap-1.5 rounded-md px-2 text-ui-caption"
        >
          {selectedWorkspace || !includeUser ? (
            <SelectedWorkspaceIcon
              className="size-3.5"
              strokeWidth={1.5}
              aria-hidden="true"
              data-testid={triggerIconTestId}
            />
          ) : (
            <Monitor
              className="size-3.5"
              strokeWidth={1.5}
              aria-hidden="true"
              data-testid={triggerIconTestId}
            />
          )}
          <span className="max-w-48 truncate">{selectedWorkspace?.label ?? userLabel}</span>
          <ChevronDown
            className="size-3 text-foreground-subtlest"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="agent-settings-typography w-48 max-w-[calc(100vw-2rem)] text-ui-caption"
      >
        <DropdownMenuRadioGroup value={selectedScopeKey} onValueChange={onScopeKeyChange}>
          {includeUser ? (
            <DropdownMenuRadioItem value="user" data-testid={userOptionTestId}>
              <Monitor className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span className="truncate text-ui-caption font-normal text-foreground">
                {userLabel}
              </span>
            </DropdownMenuRadioItem>
          ) : null}
          {scopeWorkspaces.length > 0 ? (
            <>
              {includeUser ? <DropdownMenuSeparator /> : null}
              {scopeWorkspaces.map((workspace) => {
                const WorkspaceIcon = workspace.remote ? Cloud : Folder;
                return (
                  <DropdownMenuRadioItem
                    key={workspace.key}
                    value={workspace.key}
                    data-testid={
                      workspaceOptionTestIdPrefix
                        ? testId(workspaceOptionTestIdPrefix, workspace.key)
                        : undefined
                    }
                    className="items-center py-1 text-ui-caption"
                  >
                    <WorkspaceIcon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-ui-caption font-normal text-foreground">
                        {workspace.label}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
