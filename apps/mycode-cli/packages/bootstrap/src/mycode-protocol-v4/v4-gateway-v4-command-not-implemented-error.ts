import type { FileSystemErrorCode } from "@mycode/contracts";
import { isFileSystemPortError } from "@mycode/contracts";
import type { RoutedTopicFrame, RoutedTopicWireFrame } from "@mycode/shared/mycode-protocol-v4";
import {
  MYCODE_ATTACHMENT_FAULT_CODES,
  MyCodeAttachmentFaultError,
  readMyCodeAttachmentFaultCode,
  encodeTopicWireFrames,
  measureTopicNotificationEnvelopeBytes,
} from "@mycode/shared/mycode-protocol-v4";
import type { TopicFrameReservation } from "./topic-frame-reservation.js";

export function encodeReservedTopicFrame(
  reservation: TopicFrameReservation<RoutedTopicFrame>,
): RoutedTopicWireFrame[] {
  return encodeTopicWireFrames(reservation.frame, {
    deliveryKind: reservation.deliveryKind,
    topic: reservation.frame.topic,
    subscriptionId: reservation.frame.subscriptionId,
    logicalFrameId: reservation.logicalFrameId,
    logicalFrameOrdinal: reservation.logicalFrameOrdinal,
    measurePhysicalFrameBytes: (wire) => measureTopicNotificationEnvelopeBytes(wire).maxBytes,
  }) as RoutedTopicWireFrame[];
}

export function subscriptionRouteKey(
  topic: string,
  subscriptionId: string,
  connectionId: string,
): string {
  return `${topic}\0${subscriptionId}\0${connectionId}`;
}

export function defaultLogEpoch(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function artifactRefBelongsToSession(ref: string, sessionId: string): boolean {
  return ref.startsWith(`mycode-artifact://${encodeURIComponent(sessionId)}/`);
}

/** 附件在文件系统层「确定不存在」的错误码集合。 */
export const MISSING_ATTACHMENT_FS_CODES = new Set<FileSystemErrorCode>([
  "not_found",
  "is_directory",
  "not_file",
]);

/**
 * 把 host / FileSystemPort 抛出的错误归一成带稳定码的附件 fault。
 * host 已经给出结构化 fault 码时原样透传，其余按 FileSystemPortError.code 判定；
 * 都不匹配则保持原错误，让上层按「未知」处理，而不是猜成确定分类。
 */
export function toShareStatFault(error: unknown): unknown {
  if (readMyCodeAttachmentFaultCode(error)) return error;
  if (isFileSystemPortError(error) && MISSING_ATTACHMENT_FS_CODES.has(error.code)) {
    return new MyCodeAttachmentFaultError(MYCODE_ATTACHMENT_FAULT_CODES.shareStatNotFound, {
      cause: error,
    });
  }
  return error;
}

/** 宿主 executor 对未接线命令抛出此错误 → ACK failed fault.notImplemented。 */
export class V4CommandNotImplementedError extends Error {
  constructor(type: string) {
    super(`v4 command not implemented in M3: ${type}`);
    this.name = "V4CommandNotImplementedError";
  }
}

/**
 * 命令 handler 的 noop 收口通道（「同值切换 ACK 必须可判别」）：
 * handler 判定命令无事可做（如 switchModelConfig/switchCollaborationMode 命中
 * runtime 当前值）时抛出，gateway 映射为 ACK status="noop" + reasonCode——
 * 不得以 accepted（无 result）静默吞掉，客户端才能区分「已生效」与「本来就是这个值」。
 */
export class V4CommandNoopError extends Error {
  constructor(
    readonly reasonCode: string,
    message?: string,
  ) {
    super(message ?? `v4 command is a no-op (${reasonCode})`);
    this.name = "V4CommandNoopError";
  }
}
