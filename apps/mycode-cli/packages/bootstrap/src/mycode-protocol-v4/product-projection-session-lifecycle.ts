import type { SessionEvent } from "@mycode/contracts";

import type { ConversationDelta } from "@mycode/shared/mycode-protocol-v4";

import type { ProjectionEngine } from "./product-projection-engine.js";
export const projectionSessionLifecycle = {
  // ── 生命周期 ──

  onSessionCreated(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as { contextWindow?: number };
    this.contextWindowState.maxTokens = payload.contextWindow ?? null;
    // draft 语义：会话实体已存在、无 row；phase 保持 draft，无可见 delta。
    return [];
  },
  // renameSession / 自动标题：SessionTitleUpdated(title, source) → 更新 meta。
  // custom（用户重命名）优先级最高，已 custom 后不再被 generated 覆盖（与 core titleSource 一致）。
  onSessionTitleUpdated(this: ProjectionEngine, event: SessionEvent): ConversationDelta[] {
    const payload = event.payload as {
      title?: string;
      source?: string;
    };
    const title = payload.title ?? "";
    // core 的 titleSource 有 4 值（default/first_input/generated/custom）；投影 meta 归一为
    // default/generated/custom（first_input 归入 generated：都属"非用户显式"）。
    const source: "default" | "generated" | "custom" =
      payload.source === "custom"
        ? "custom"
        : payload.source === "default"
          ? "default"
          : "generated";
    const prev = this.snapshot.meta;
    if (prev.titleSource === "custom" && source === "generated") return [];
    if (prev.title === title && prev.titleSource === source) return [];
    return [
      {
        op: "state.updated",
        patch: { meta: { title, titleSource: source } },
      },
    ];
  },
};
export type ProjectionSessionLifecycleMethods = typeof projectionSessionLifecycle;
