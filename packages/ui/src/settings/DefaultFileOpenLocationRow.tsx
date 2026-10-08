import { useMemo } from "react";
import { useInstalledEditors } from "@/hooks/useInstalledEditors.js";
import { usePreferredEditorId } from "@/hooks/usePreferredEditorId.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { persistLastSelectedEditorId } from "@/lib/editorPreference.js";
import { resolveWorkspaceEditorSelection } from "@/lib/workspaceEditorSelection.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";

export function DefaultFileOpenLocationRow() {
  const { intl } = useMyCodeIntl();
  const installedEditors = useInstalledEditors();
  const selectedEditorId = usePreferredEditorId();
  const { availableEditors, selectedEditor } = useMemo(
    () =>
      resolveWorkspaceEditorSelection({
        installedEditors,
        selectedEditorId,
      }),
    [installedEditors, selectedEditorId],
  );
  return (
    <SettingsRow
      label={intl.formatMessage({ id: "settings.defaultFileOpenLocation" })}
      description={intl.formatMessage({ id: "settings.defaultFileOpenLocationDescription" })}
      control={
        <Select
          value={selectedEditor?.id ?? ""}
          disabled={!selectedEditor}
          onValueChange={(id) => {
            // 这里只修改既有默认偏好；选择设置不能沿用顶栏打开操作的副作用。
            if (availableEditors.some((editor) => editor.id === id))
              persistLastSelectedEditorId(id);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-[260px] min-w-0 justify-between"
            data-testid="default-file-open-location"
          >
            <SelectValue
              placeholder={intl.formatMessage({ id: "settings.defaultFileOpenLocationEmpty" })}
            />
          </SelectTrigger>
          <SelectContent>
            {availableEditors.map((editor) => (
              <SelectItem key={editor.id} value={editor.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <img src={editor.iconDataUrl} alt="" className="size-4 shrink-0" />
                  <span className="truncate">{editor.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
