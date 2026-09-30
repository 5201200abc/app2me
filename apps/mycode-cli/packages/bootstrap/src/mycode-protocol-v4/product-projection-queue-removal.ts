import type { ConversationDelta } from "@mycode/shared/mycode-protocol-v4";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionQueueRemoval = {
  removeQueueItems(this: ProjectionEngine, ids: readonly string[]): ConversationDelta[] {
    const idSet = new Set(ids);
    for (const id of ids) this.deliveryByPendingInputId.delete(id);
    const items = this.snapshot.queue.items
      .filter((item) => !idSet.has(item.queueItemId))
      .map((item, index) =>
        item.order.queuePosition === index
          ? item
          : { ...item, order: { ...item.order, queuePosition: index } },
      );
    if (items.length === this.snapshot.queue.items.length) return [];
    return [
      {
        op: "state.updated",
        patch: this.queuePatch({ ...this.snapshot.queue, items }),
      },
    ];
  },
};
export type ProjectionQueueRemovalMethods = typeof projectionQueueRemoval;
