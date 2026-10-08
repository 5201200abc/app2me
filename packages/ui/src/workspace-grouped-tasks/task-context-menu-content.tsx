import type { MyCodeTaskMeta } from "@mycode/shared";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu.js";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.js";
import { TaskGroupColorDot } from "@/workspace-grouped-tasks/colors.js";
import type { TaskGroupMenuItem } from "@/workspace-grouped-tasks/types.js";

export function GroupedTaskContextMenuContent({
  task,
  currentGroupId,
  groups,
  intl,
  fileManagerLabel,
  taskSessionFile,
  taskNativeSessionLogFile,
  onMoveTaskToGroup,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  onOpenTaskPathInFileManager,
  onCopyText,
  onOpenTaskFeedback,
  disabledReason,
  menuKind = "context",
}: {
  task: MyCodeTaskMeta;
  currentGroupId?: string;
  groups: TaskGroupMenuItem[];
  intl: {
    formatMessage: (desc: { id: string }) => string;
  };
  fileManagerLabel: string;
  taskSessionFile: { loading: boolean; path: string | null };
  taskNativeSessionLogFile: { loading: boolean; path: string | null };
  onMoveTaskToGroup: (task: MyCodeTaskMeta, groupId: string | null) => void;
  onStartRenameTask: (task: MyCodeTaskMeta) => void;
  onArchiveTask: (task: MyCodeTaskMeta) => void;
  onMarkTaskAsUnread: (task: MyCodeTaskMeta) => void;
  onOpenTaskPathInFileManager: () => void;
  onCopyText: (label: string, text: string | null) => void;
  onOpenTaskFeedback: () => void;
  disabledReason?: string;
  menuKind?: "context" | "dropdown";
}) {
  const Content = menuKind === "dropdown" ? DropdownMenuContent : ContextMenuContent;
  const Item = menuKind === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  const Separator = menuKind === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator;
  const Sub = menuKind === "dropdown" ? DropdownMenuSub : ContextMenuSub;
  const SubContent = menuKind === "dropdown" ? DropdownMenuSubContent : ContextMenuSubContent;
  const SubTrigger = menuKind === "dropdown" ? DropdownMenuSubTrigger : ContextMenuSubTrigger;
  return (
    <Content
      className="w-56"
      {...(menuKind === "dropdown"
        ? { side: "right" as const, align: "start" as const, "data-sidebar-task-menu": "" }
        : {})}
    >
      <Sub>
        <SubTrigger disabled={Boolean(disabledReason)} title={disabledReason}>
          {intl.formatMessage({ id: "taskGroup.moveToGroup" })}
        </SubTrigger>
        <SubContent className="w-52">
          <Item
            disabled={Boolean(disabledReason) || !currentGroupId}
            title={disabledReason}
            onSelect={() => {
              if (!disabledReason) {
                onMoveTaskToGroup(task, null);
              }
            }}
          >
            {intl.formatMessage({ id: "taskGroup.removeFromGroup" })}
          </Item>
          <Separator />
          {groups.map((group) => (
            <Item
              key={group.id}
              disabled={Boolean(disabledReason) || group.id === currentGroupId}
              title={disabledReason}
              onSelect={() => {
                if (!disabledReason) {
                  onMoveTaskToGroup(task, group.id);
                }
              }}
            >
              <TaskGroupColorDot color={group.color} />
              <span className="truncate">{group.title}</span>
            </Item>
          ))}
        </SubContent>
      </Sub>
      <Separator />
      <Item
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        onSelect={() => {
          if (!disabledReason) {
            onStartRenameTask(task);
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.rename" })}
      </Item>
      <Item
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        onSelect={() => {
          if (!disabledReason) {
            onArchiveTask(task);
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.archive" })}
      </Item>
      <Item
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        onSelect={() => {
          if (!disabledReason) {
            onMarkTaskAsUnread(task);
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.markAsUnread" })}
      </Item>
      <Separator />
      <Item
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        onSelect={() => {
          if (!disabledReason) {
            onOpenTaskPathInFileManager();
          }
        }}
      >
        {fileManagerLabel}
      </Item>
      <Item
        onSelect={() =>
          onCopyText(intl.formatMessage({ id: "appHeader.copyPath" }), task.workspacePath)
        }
      >
        {intl.formatMessage({ id: "appHeader.copyPath" })}
      </Item>
      <Item
        disabled={taskSessionFile.loading || !taskSessionFile.path}
        onSelect={() =>
          onCopyText(intl.formatMessage({ id: "appHeader.copyTaskPath" }), taskSessionFile.path)
        }
      >
        {intl.formatMessage({ id: "appHeader.copyTaskPath" })}
      </Item>
      <Item
        disabled={taskNativeSessionLogFile.loading || !taskNativeSessionLogFile.path}
        onSelect={() =>
          onCopyText(
            intl.formatMessage({ id: "appHeader.copyLogPath" }),
            taskNativeSessionLogFile.path,
          )
        }
      >
        {intl.formatMessage({ id: "appHeader.copyLogPath" })}
      </Item>
      <Item
        onSelect={() =>
          onCopyText(intl.formatMessage({ id: "appHeader.copySessionId" }), task.taskId)
        }
      >
        {intl.formatMessage({ id: "appHeader.copySessionId" })}
      </Item>
      <Separator />
      <Item onSelect={onOpenTaskFeedback}>{intl.formatMessage({ id: "taskList.feedback" })}</Item>
    </Content>
  );
}
