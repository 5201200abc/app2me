import type { SessionEvent } from "@mycode/contracts";

import type { ConversationDelta } from "@mycode/shared/mycode-protocol-v4";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionMode = {
  /**
   * switchCollaborationMode：SessionModeChanged → config.mode。
   * 事件来源覆盖命令面（source=command）与 plan 工具路径（enterPlanMode/exitPlanMode，
   * source=tool）——两条路径共用这条投影，UI 的模式选择器因此也能跟随工具驱动的模式切换。
   */
  onSessionModeChanged(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as {
      mode?: string;
      planEnabled?: boolean;
      source?: string;
      toolCallId?: string;
      permissionGrant?: { interactionId: string; queueItemIds: string[] };
    };
    const mode = typeof payload.mode === "string" ? payload.mode : "";
    // 日志事件触碰过 mode 后，种子不再覆盖（同值 return 也算触碰——日志有权威值）。
    if (mode) this.configModeTouchedByEvent = true;
    if (!mode) return [];
    const planEnabled = payload.planEnabled ?? mode === "plan";
    const planTransition =
      payload.source === "tool" && payload.toolCallId
        ? { toolCallId: payload.toolCallId, planEnabled }
        : this.snapshot.config.planTransition;
    if (
      this.snapshot.config.mode === mode &&
      this.snapshot.config.planEnabled === planEnabled &&
      planTransition === this.snapshot.config.planTransition &&
      !payload.permissionGrant
    )
      return [];
    return [
      {
        op: "state.updated",
        patch: {
          ...(payload.permissionGrant
            ? this.queuePatch({
                ...this.snapshot.queue,
                items: this.snapshot.queue.items.map((item) =>
                  payload.permissionGrant!.queueItemIds.includes(item.queueItemId)
                    ? { ...item, mode: "yolo" as const }
                    : item,
                ),
              })
            : {}),
          config: {
            ...this.snapshot.config,
            mode,
            planEnabled,
            planTransition,
            ...(payload.permissionGrant
              ? { permissionGrant: { interactionId: payload.permissionGrant.interactionId } }
              : {}),
          },
        },
      },
    ];
  },
};
export type ProjectionModeMethods = typeof projectionMode;
