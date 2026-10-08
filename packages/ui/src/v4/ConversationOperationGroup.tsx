import type { ReactNode } from "react";
import {
  BookOpenIcon,
  EyeIcon,
  Pointer2Icon,
  SearchIcon,
  SquareTerminal,
  Waypoints,
  WrenchIcon,
} from "@/components/icons/tabler.js";
import { WriteIcon } from "@/components/ui/write-icon.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import {
  ToolOperationListContext,
  ToolPresentationScopeContext,
} from "@/ToolCallBlocks/ToolPresentationContext.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { describeOperationGroup, usesComputerOperationIcon } from "@/v4/compactOperationGroups.js";
import type { ToolCallRow } from "@mycode/shared/mycode-protocol-v4";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

export function ConversationOperationGroup({
  groupId,
  rows,
  context,
  renderContent,
}: {
  groupId: string;
  rows: readonly ToolCallRow[];
  context: ConversationRowRenderContext;
  renderContent: () => ReactNode;
}) {
  const { locale } = useMyCodeIntl();
  const summary = describeOperationGroup(rows, locale);
  // 分组笔图标和全局 CUA 覆盖会抢走首项类别；图标只跟随当前摘要的优先项。
  const icon = {
    skill: <WrenchIcon />,
    read: <BookOpenIcon />,
    edit: <WriteIcon />,
    command: <SquareTerminal />,
    search: <SearchIcon />,
    image: <EyeIcon />,
    integration: usesComputerOperationIcon(rows) ? <Pointer2Icon /> : <Waypoints />,
  }[summary.icon];
  return (
    <ToolPresentationScopeContext.Provider
      value={JSON.stringify([
        context.workspaceIdentity?.trim() || context.workspacePath,
        context.sessionId,
        context.logEpoch,
      ])}
    >
      <ToolLayout
        variant="operations"
        toolId={groupId}
        icon={icon}
        kindLabel={summary.text}
        primaryText={null}
        isRunning={summary.running}
        title={summary.text}
        renderContent={() => (
          <ToolOperationListContext.Provider value={true}>
            {renderContent()}
          </ToolOperationListContext.Provider>
        )}
      />
    </ToolPresentationScopeContext.Provider>
  );
}
