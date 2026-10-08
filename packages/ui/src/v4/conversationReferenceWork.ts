import type {
  ConversationTurnRenderUnit,
  ConversationTurnWorkSegment,
} from "@/v4/conversationTurnRenderUnits.js";

export function formatReferenceWorkDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return "";
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** 仅改变折叠展示；guide、正文、原始行顺序及 CLI 工作段边界保留。 */
export function referenceWorkSegments(
  unit: ConversationTurnRenderUnit,
): ConversationTurnWorkSegment[] {
  const segments = unit.workSegments?.length
    ? unit.workSegments
    : [
        {
          key: unit.key,
          flowItems: unit.flowItems,
          assistantWorkRows: unit.assistantWorkRows,
          assistantHistoryRows: unit.assistantHistoryRows,
          assistantFollowingRows: unit.assistantFollowingRows,
          assistantHistoryDefaultOpen: false,
          workStatus: unit.workStatus,
        },
      ];
  const summaryIndex = segments.findIndex((segment) =>
    segment.flowItems.some(
      (item) =>
        item.kind === "assistantWork" ||
        item.kind === "assistantHistory" ||
        item.kind === "cuaGroup",
    ),
  );
  return segments.map((segment, index) => ({
    ...segment,
    assistantHistoryDefaultOpen: false,
    ...(index === summaryIndex && unit.workStatus ? { workStatus: unit.workStatus } : {}),
    flowItems: segment.flowItems.map((item) =>
      item.kind === "assistantWork"
        ? { ...item, kind: "assistantHistory" as const }
        : item.kind === "cuaGroup"
          ? { ...item, flowKind: "assistantHistory" as const }
          : item,
    ),
  }));
}
