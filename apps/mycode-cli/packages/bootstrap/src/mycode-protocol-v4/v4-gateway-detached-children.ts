import type { SessionEvent } from "@mycode/contracts";

import { SessionEventType } from "@mycode/contracts";

import { DETACHED_CHILD_PUBLISHER_GRACE_MS } from "./v4-gateway-v4-gateway-host.js";

import type { V4GatewayEngine } from "./v4-gateway-engine.js";
export const gatewayDetachedChildren = {
  /**
   * subagent child 使用父 record 的外部 sink，但保留独立 session topic。显式登记这类
   * detached live session，避免把任意偶然存在的 cold publisher 都误判为运行中 child。
   */
  ingestDetachedLiveSession(
    this: V4GatewayEngine,
    sessionId: string,
    event: SessionEvent,
    parentSessionId?: string,
  ): void {
    if (!this.detachedLiveSessions.has(sessionId)) {
      this.host.onDebug?.(`register detached live child publisher session=${sessionId}`);
    }
    this.detachedLiveSessions.add(sessionId);
    if (parentSessionId && parentSessionId !== sessionId) {
      this.detachedChildParent.set(sessionId, parentSessionId);
      let children = this.detachedChildrenByParent.get(parentSessionId);
      if (!children) {
        children = new Set();
        this.detachedChildrenByParent.set(parentSessionId, children);
      }
      children.add(sessionId);
    }
    // child 是一次性 session，没有 record 也没有后继 turn，publisher 曾驻留到进程退出。
    // 记下终态时间，供 pruneDetachedChildPublishers 在 grace 后释放；child 再次开 turn 则撤销。
    if (event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError) {
      this.detachedTerminalAt.set(sessionId, Date.now());
    } else if (event.type === SessionEventType.TurnStarted) {
      this.detachedTerminalAt.delete(sessionId);
    }
    this.ingest(sessionId, event);
  },
  /**
   * 低频 tick 兜底：释放已终态、无订阅者、且没有自己 record 的 detached child publisher。
   * 释放后再被订阅走既有 cold resume（child 作为 subagent_child 持久化在 session store）。返回释放数。
   */
  pruneDetachedChildPublishers(
    this: V4GatewayEngine,
    nowMs: number = Date.now(),
    graceMs: number = DETACHED_CHILD_PUBLISHER_GRACE_MS,
  ): number {
    let released = 0;
    for (const [childId, terminalAt] of [...this.detachedTerminalAt]) {
      if (nowMs - terminalAt < graceMs) continue;
      if (this.host.sessionExists(childId)) continue;
      if (this.publishers.get(childId)?.hasSubscribers()) continue;
      this.releaseDetachedChild(childId);
      released += 1;
    }
    return released;
  },
  releaseDetachedChild(this: V4GatewayEngine, childId: string): void {
    this.host.onDebug?.(`release detached live child publisher session=${childId}`);
    this.cleanupSessionRuntime(childId, { clearCommandInbox: false, notifyIndexRemoved: false });
  },
  /**
   * 运行中 subagent 没有独立 bootstrap record，但 raw child events 会先建立 publisher。
   * publisher 已存在就代表 conversation live 可订阅，不能再把同一 child cold resume 成
   * 第二个 runtime；真正的历史 session 仍由 host record / persisted resume 负责。
   */
  hasLiveConversation(this: V4GatewayEngine, sessionId: string): boolean {
    return this.host.sessionExists(sessionId) || this.detachedLiveSessions.has(sessionId);
  },
};
export type GatewayDetachedChildrenMethods = typeof gatewayDetachedChildren;
