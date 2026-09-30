import type {
  WorkspaceConfigState,
  WorkspaceConfigTopicFrame,
} from "@mycode/shared/mycode-protocol-v4";
import {
  parseWorkspaceConfigTopic,
  v4ConversationSubscribeParamsSchema,
} from "@mycode/shared/mycode-protocol-v4";

import { WorkspaceConfigPublisher } from "./workspace-config-publisher.js";

import { type V4SubscribeDispatchResult } from "./v4-gateway-v4-gateway-host.js";

import type { V4GatewayEngine } from "./v4-gateway-engine.js";
export const gatewayWorkspaceConfig = {
  /**
   * workspace-config 订阅：订阅某 workspace 的配置目录（与 conversation subscribe 并列，
   * 同一 RPC 方法按 topic 前缀分派）。订阅时经宿主钩子拉取当前配置作种子。
   */
  async subscribeWorkspaceConfig(
    this: V4GatewayEngine,
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    const dispatch = await this.subscribeWorkspaceConfigReserved(rawParams);
    dispatch.commit();
    return dispatch;
  },
  async subscribeWorkspaceConfigReserved(
    this: V4GatewayEngine,
    rawParams: unknown,
  ): Promise<V4SubscribeDispatchResult<WorkspaceConfigTopicFrame>> {
    const params = v4ConversationSubscribeParamsSchema.parse(rawParams);
    const workspaceId = parseWorkspaceConfigTopic(params.topic);
    if (workspaceId === null) {
      throw new Error(`Not a workspace-config topic: ${params.topic}`);
    }
    const publisher = await this.ensureConfigPublisher(workspaceId);
    const result = publisher.subscribeReserved(params.connectionId, params.base);
    try {
      return this.subscribeDispatch(
        {
          subscriptionId: result.subscriptionId,
          mode: result.mode,
          logEpoch: publisher.logEpoch,
        },
        result.reservation,
        () => this.flushConfig(workspaceId),
      );
    } catch (error) {
      // 与 sessions-index 同一原子边界：encode 失败 = subscribe 未 admission。
      result.rollback();
      throw error;
    }
  },
  /**
   * 配置目录发布入口（宿主在 provider registry 应用 / workspace 默认项变更后调用，
   * 直接携带已构建好的目录，不回头重拉宿主，避免重复 buildWorkspaceState 的临时 app 成本）。
   * conflation 在 publisher 内完成（未变化不产帧）；无 publisher 时同步建一个空种子的
   * publisher 存住最新态，后续订阅者据此拿到完整 snapshot。
   */
  publishWorkspaceConfig(
    this: V4GatewayEngine,
    workspaceId: string,
    state: WorkspaceConfigState,
  ): void {
    if (this.disposed) return;
    let publisher = this.configPublishers.get(workspaceId);
    if (!publisher) {
      publisher = new WorkspaceConfigPublisher(
        workspaceId,
        this.createLogEpoch(`workspace-config/${workspaceId}`),
        this.now,
      );
      this.configPublishers.set(workspaceId, publisher);
    }
    try {
      if (publisher.publish(state)) this.flushConfig(workspaceId);
    } catch (error) {
      this.host.onError?.("v4.workspaceConfig.publish", error);
    }
  },
  async pullWorkspaceConfig(
    this: V4GatewayEngine,
    workspaceId: string,
  ): Promise<WorkspaceConfigState | null> {
    if (!this.host.getWorkspaceConfig) return null;
    return (await this.host.getWorkspaceConfig(workspaceId)) ?? null;
  },
  /** 建/取某 workspace 的 config publisher；建时经宿主钩子拉取当前目录作种子。 */
  async ensureConfigPublisher(
    this: V4GatewayEngine,
    workspaceId: string,
  ): Promise<WorkspaceConfigPublisher> {
    const existing = this.configPublishers.get(workspaceId);
    if (existing) return existing;
    const publisher = new WorkspaceConfigPublisher(
      workspaceId,
      this.createLogEpoch(`workspace-config/${workspaceId}`),
      this.now,
    );
    const seed = await this.pullWorkspaceConfig(workspaceId).catch((error) => {
      this.host.onError?.("v4.workspaceConfig.seed", error);
      return null;
    });
    if (seed) publisher.publish(seed);
    // await 期间的并发订阅可能已注册同 workspace publisher → 以先注册者为准。
    const raced = this.configPublishers.get(workspaceId);
    if (raced) return raced;
    this.configPublishers.set(workspaceId, publisher);
    return publisher;
  },
  /** 把某 workspace config publisher 的未发增量帧推给所有订阅者。 */
  flushConfig(this: V4GatewayEngine, workspaceId: string, onlyConnectionId?: string): void {
    const publisher = this.configPublishers.get(workspaceId);
    if (!publisher) return;
    for (const subscriptionId of publisher.subscriptionIds()) {
      const connectionId = publisher.connectionIdForSubscription(subscriptionId);
      if (
        connectionId === null ||
        this.pausedConnections.has(connectionId) ||
        (onlyConnectionId !== undefined && connectionId !== onlyConnectionId)
      ) {
        continue;
      }
      const reservation = publisher.reserveFlush(subscriptionId);
      if (!reservation) continue;
      try {
        this.emitReservation(reservation);
      } catch (error) {
        this.host.onError?.("v4.workspaceConfig.emit", error);
      }
    }
  },
};
export type GatewayWorkspaceConfigMethods = typeof gatewayWorkspaceConfig;
