import { useContext } from "react";
import { EditIcon, PencilOffIcon, type UiIconProps } from "@/components/icons/tabler.js";
import { ToolPresentationStatusContext } from "@/ToolCallBlocks/ToolPresentationContext.js";

/** 编辑操作复用线性铅笔；失败态由现有投影决定，错误内容仍保留在展开区。 */
export function WriteIcon({ failed, ...props }: UiIconProps & { failed?: boolean }) {
  const status = useContext(ToolPresentationStatusContext);
  const isFailed = failed ?? status === "failed";
  const Icon = isFailed ? PencilOffIcon : EditIcon;
  return <Icon {...props} data-write-icon data-write-icon-state={isFailed ? "failed" : "edit"} />;
}
