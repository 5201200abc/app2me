import { registerForkedSession } from "./server-operations.js";
import type {
  MyCodeProtocolAgentServerContext,
  MyCodeProtocolSessionRecord,
} from "./server-types.js";
import { recordForkStartFailureBestEffort } from "./v4-bridge-resolve-input-command-for-admission.js";

/**
 * Fork bundle commit 是命令 PONR；后续 catalog/model/resume/snapshot 仅恢复 runtime 可达性。
 * 该阶段失败必须留下可重试事实与 warning，但不能把 durable accepted child 反转成 failed。
 */
export async function registerCommittedForkBestEffort(
  context: MyCodeProtocolAgentServerContext,
  record: MyCodeProtocolSessionRecord,
  fork: Parameters<typeof registerForkedSession>[2],
  options: Parameters<typeof registerForkedSession>[3] & { commandId: string },
  register: typeof registerForkedSession = registerForkedSession,
): Promise<void> {
  const { commandId, ...registrationOptions } = options;
  try {
    await register(context, record, fork, registrationOptions);
  } catch (error) {
    const forkedSessionId = String(fork.forkedSessionId);
    const parentSessionId = String(fork.parentSessionId ?? record.app.sessionId);
    await recordForkStartFailureBestEffort(context, forkedSessionId, { commandId }, error, {
      parentSessionId,
      registrationRequired: true,
    });
    try {
      context.logger?.warn("fork child registration failed after durable commit", {
        commandId,
        error: error instanceof Error ? error.message : String(error),
        forkedSessionId,
        parentSessionId,
        retryable: true,
      });
    } catch {
      // logger 自身异常过去会越过 PONR 冒泡，让 gateway 错误 settle 为 failed。
    }
  }
}
