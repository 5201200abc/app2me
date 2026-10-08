import { Images } from "@/components/icons/tabler.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { buildNodeReplDisplayModel } from "@/lib/nodeReplToolDisplay.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { NodeReplImageGrid } from "@/ToolCallBlocks/renderers/nodeReplImageGrid.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

export function ViewImageToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useMyCodeIntl();
  const toolCall = context.toolCallNode.toolCall;
  const model = buildNodeReplDisplayModel(toolCall);
  const label = intl.formatMessage({ id: "chat.toolCall.viewedImage" });
  return (
    <ToolLayout
      variant="image"
      toolId={toolCall.toolId}
      icon={<Images className="size-3.5" strokeWidth={1.5} />}
      kindLabel={label}
      primaryText={null}
      isRunning={context.isRunning}
      statusLabel={intl.formatMessage({ id: "chat.toolCall.status.failed" })}
      statusTooltip={context.errorText}
      showFailureStatus={toolCall.status === "failed"}
      renderContent={() => <NodeReplImageGrid images={model.images} resultImageLabel={label} />}
    />
  );
}
