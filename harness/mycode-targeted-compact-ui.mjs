import { verifyArtifactSources } from "./mycode-artifact-sources.mjs";
import { verifyConversationUiPolish } from "./mycode-conversation-ui-polish.mjs";
import { verifySourcesSidebar } from "./mycode-sources-sidebar.mjs";
import { verifyWriteIconPolish } from "./mycode-write-icon-polish.mjs";
import { verifyConversationDetailSettings } from "./mycode-conversation-detail-settings.mjs";
import { verifyInventoryToolPolish } from "./mycode-inventory-tool-polish.mjs";
import { verifyOperationGroups } from "./mycode-operation-groups.mjs";
import { verifyReferenceConversation } from "./mycode-reference-conversation.mjs";
import { verifyConversationEdgeAlignment } from "./mycode-conversation-edge-alignment.mjs";
import { verifyPluginMcpCopy } from "./mycode-plugin-mcp-copy.mjs";
import { verifySettingsGroups } from "./mycode-settings-groups.mjs";
import { verifySummaryZoomPolish } from "./mycode-summary-zoom-polish.mjs";

export async function verifyTargetedCompactUi(page, app, output, scope) {
  if (scope === "sources-sidebar") {
    await verifySourcesSidebar(page, output);
    await verifyConversationUiPolish(page, output);
    return verifyWriteIconPolish(page, output);
  }
  if (scope === "artifact-sources") return verifyArtifactSources(page, output);
  if (scope === "operation-groups") return verifyOperationGroups(page, output);
  if (scope === "conversation-detail-settings")
    return verifyConversationDetailSettings(page, output);
  if (scope === "conversation-edge-alignment") return verifyConversationEdgeAlignment(page, output);
  if (scope === "reference-conversation") return verifyReferenceConversation(page, app, output);
  if (scope === "inventory-tools") return verifyInventoryToolPolish(page, output);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (scope === "summary-zoom-polish") return verifySummaryZoomPolish(page, app, output);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByTestId("settings-page");
  await settings.waitFor();
  if (scope === "settings-groups") return verifySettingsGroups(page, output);
  await settings.getByRole("button", { name: "插件", exact: true }).click();
  return verifyPluginMcpCopy(page, output);
}
