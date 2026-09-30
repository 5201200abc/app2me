import type { ConversationTopicFrame, SubscribeAck } from "@mycode/shared/mycode-protocol-v4";

import type { TopicFrameReservation } from "./topic-frame-reservation.js";
import {
  type Subscription,
  appendConversationSubscriberBuffer,
  type ConversationSubscribeResult,
} from "./conversation-topic-publisher-projection-payload-too-large-error.js";
interface ConversationRollbackContext {
  subscriptions: ReadonlyMap<string, Subscription>;
  subscriberBufferMaxOps: number;
  subscriberBufferMaxBytes: number;
}
export function createResyncRollback(
  context: ConversationRollbackContext,
  subscription: Subscription,
  reservation: TopicFrameReservation<ConversationTopicFrame>,
  previous: Pick<
    Subscription,
    "buffer" | "bufferBytes" | "resyncRequired" | "sentSeq" | "inFlight"
  >,
): () => boolean {
  let rolledBack = false;
  return (): boolean => {
    if (rolledBack) return true;
    if (
      context.subscriptions.get(subscription.subscriptionId) !== subscription ||
      subscription.inFlight !== reservation
    ) {
      return false;
    }
    const recoveryBuffer = subscription.buffer;
    const recoveryResyncRequired = subscription.resyncRequired;
    const merged = appendConversationSubscriberBuffer(previous.buffer, recoveryBuffer, {
      maxOps: context.subscriberBufferMaxOps,
      maxBytes: context.subscriberBufferMaxBytes,
    });
    if (merged.kind === "overflow" || previous.resyncRequired || recoveryResyncRequired) {
      subscription.buffer = [];
      subscription.bufferBytes = 0;
      subscription.resyncRequired = true;
    } else {
      subscription.buffer = merged.deltas;
      subscription.bufferBytes = merged.encodedBytes;
      subscription.resyncRequired = false;
    }
    subscription.sentSeq = previous.sentSeq;
    subscription.inFlight = previous.inFlight;
    rolledBack = true;
    return true;
  };
}
export function createConversationSubscribeResult(
  ack: SubscribeAck,
  reservation: TopicFrameReservation<ConversationTopicFrame> | null,
  rollback: () => boolean,
): ConversationSubscribeResult {
  return {
    ack,
    reservation,
    rollback,
    // 兼容旧 publisher 单测：读 frame 即表示本地 transport 已接受。
    // 生产 gateway 只读 reservation，不会触发该 getter。
    get frame() {
      reservation?.commit();
      return reservation?.frame ?? null;
    },
  };
}
