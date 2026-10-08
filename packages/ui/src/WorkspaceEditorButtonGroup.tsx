import { createOpenInEditorRemoteTarget, type EditorInfo, type RemoteTarget } from "@mycode/shared";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { persistLastSelectedEditorId } from "@/lib/editorPreference.js";
import {
  resolveWorkspaceEditorSelection,
  shouldPersistWorkspaceEditorSelection,
} from "@/lib/workspaceEditorSelection.js";
import { usePreferredEditorId } from "@/hooks/usePreferredEditorId.js";
import { useInstalledEditors } from "@/hooks/useInstalledEditors.js";
import { logger } from "@/logger.js";

export function WorkspaceEditorButtonGroup({
  disabledReason,
  workspaceAbsPath,
  workspaceIdentity,
  remoteTarget,
  onSelectedEditorChange,
}: {
  disabledReason?: string;
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  remoteTarget?: RemoteTarget;
  onSelectedEditorChange?: (editor: EditorInfo | null) => void;
}) {
  const { intl } = useMyCodeIntl();
  const platform = usePlatform();

  const installedEditors = useInstalledEditors();
  const selectedEditorId = usePreferredEditorId();

  const { selectedEditor } = useMemo(
    () =>
      resolveWorkspaceEditorSelection({
        installedEditors: installedEditors,
        selectedEditorId,
        remoteTarget,
      }),
    [installedEditors, remoteTarget, selectedEditorId],
  );

  useEffect(() => {
    onSelectedEditorChange?.(selectedEditor);
  }, [onSelectedEditorChange, selectedEditor]);
  const editorIconClassName = useMemo(() => {
    // Windows 上编辑器图标的视觉占比普遍更大，继续用 size-6 会让按钮显得偏挤。
    // 这里只在当前按钮做平台级微调，不影响菜单里的通用图标尺寸。
    if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
      return "size-4 shrink-0";
    }

    return "size-5 shrink-0";
  }, []);
  const handleOpenEditor = (editor: EditorInfo) => {
    if (disabledReason) {
      return;
    }
    if (shouldPersistWorkspaceEditorSelection("explicit")) {
      persistLastSelectedEditorId(editor.id);
    }
    const openOptions =
      remoteTarget || workspaceIdentity
        ? {
            remoteTarget: remoteTarget ? createOpenInEditorRemoteTarget(remoteTarget) : undefined,
            workspaceIdentity,
          }
        : undefined;

    void platform.openInEditor(editor.id, workspaceAbsPath, openOptions).then((result) => {
      if (result.success) {
        return;
      }
      logger.warn("[WorkspaceEditorButtonGroup] 打开编辑器失败", {
        editorId: editor.id,
        workspaceAbsPath,
        workspaceIdentity,
        error: result.error ?? "unknown-error",
      });
    });
  };

  if (!selectedEditor) {
    return null;
  }

  return (
    <div className="flex items-center h-7 rounded-lg border border-border bg-input overflow-hidden p-0 hover:border-border-hover">
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        className="size-7 rounded-lg border-0"
        disabled={Boolean(disabledReason)}
        onClick={() => handleOpenEditor(selectedEditor)}
        aria-label={intl.formatMessage(
          { id: "appHeader.openInEditor" },
          { editor: selectedEditor.name },
        )}
        title={
          disabledReason ??
          intl.formatMessage({ id: "appHeader.openInEditor" }, { editor: selectedEditor.name })
        }
      >
        <img
          src={selectedEditor.iconDataUrl}
          alt={selectedEditor.name}
          className={editorIconClassName}
        />
      </Button>
    </div>
  );
}
