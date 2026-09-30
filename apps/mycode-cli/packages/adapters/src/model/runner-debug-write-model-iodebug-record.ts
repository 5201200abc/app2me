import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeModelIODebugRecord } from "./runner-debug-redaction.js";
import { stringMetadata } from "./runner-record.js";
import {
  getModelIOBaseDir,
  sanitizeFileSegment,
  stringifyDebugRecord,
  modelIOCompactionStates,
  buildModelIOCompactionState,
  rotateModelIOFiles,
  MAX_ROLLOUT_FILES,
  readFileSize,
  MAX_DEBUG_SESSION_BYTES,
  MAX_ROLLOUT_SESSION_BYTES,
  MAX_DEBUG_BASELINE_MESSAGES,
  MAX_ROLLOUT_BASELINE_MESSAGES,
  asRecord,
  prepareProductionRequestRecord,
  prepareProductionResponseRecord,
  type ModelIOCompactionState,
  type ModelIORequestCompactionState,
  type ModelIOCollectionState,
  fingerprintValue,
  fingerprintCollectionSamples,
} from "./runner-debug-should-record-model-io.js";

export function writeModelIODebugRecord(
  record: Record<string, unknown>,
  debugDir?: string,
  isDev?: boolean,
  modelIoFullRetentionEnabled = false,
): void {
  try {
    // model-I/O 诊断直接持久化 AI SDK 的 request/response headers，
    // 闲时 Provider 的 JWT、Coding Plan Key 与 ticket 因此会写入按 session 命名的文件。
    // 在统一落盘边界复用网络遥测脱敏，保证 generate/stream 及后续调用方都不会漏掉。
    const sanitizedRecord = sanitizeModelIODebugRecord(record);
    const development = isDev ?? false;
    const dir = debugDir ?? getModelIOBaseDir(isDev ?? false);
    mkdirSync(dir, { recursive: true });
    const sessionSegment =
      sanitizeFileSegment(stringMetadata(sanitizedRecord.sessionId)) || "no-session";
    const fileName = `model-io-${sessionSegment}.jsonl`;
    const filePath = join(dir, fileName);
    const fileExists = existsSync(filePath);
    if (modelIoFullRetentionEnabled) {
      // 全量保留仍经过统一脱敏边界，但跳过轮转、限额重置、生产裁剪和上下文压缩。
      // 这是用户显式选择的诊断模式；更新 compaction state 使关闭后下一次 bounded 写入可平滑续接。
      appendFileSync(filePath, `${stringifyDebugRecord(sanitizedRecord)}\n`, "utf8");
      modelIOCompactionStates.set(filePath, buildModelIOCompactionState(sanitizedRecord));
      return;
    }
    // 生产态(rollout)做容量上限,避免长期运行把磁盘刷爆;开发态(debug)也保留更高的单文件上限。
    // 同一 session 之前每次模型请求都会新建一个完整上下文文件，形成三角形重复；
    // 现在改为一个 session 一个 JSONL 文件，新请求 append 到同文件，只有新 session 才参与淘汰。
    if (!development && !fileExists) {
      rotateModelIOFiles(dir, MAX_ROLLOUT_FILES - 1);
    }
    const existingBytes = fileExists ? readFileSize(filePath) : 0;
    const maxSessionBytes = development ? MAX_DEBUG_SESSION_BYTES : MAX_ROLLOUT_SESSION_BYTES;
    const resetForSizeLimit = existingBytes >= maxSessionBytes;
    const preparedRecord = prepareModelIORecordForWrite(sanitizedRecord, development);
    const previousState =
      fileExists && !resetForSizeLimit ? modelIOCompactionStates.get(filePath) : undefined;
    const compacted = compactModelIORecord(preparedRecord, previousState, {
      maxBaselineMessages: development
        ? MAX_DEBUG_BASELINE_MESSAGES
        : MAX_ROLLOUT_BASELINE_MESSAGES,
      preserveFullBodyMessages: Boolean(preparedRecord.error),
    });
    const recordToWrite = resetForSizeLimit
      ? {
          ...compacted,
          modelIOReset: {
            maxFileBytes: maxSessionBytes,
            previousFileBytes: existingBytes,
            reason: "session_file_size_limit",
          },
        }
      : compacted;
    const line = `${stringifyDebugRecord(recordToWrite)}\n`;
    if (resetForSizeLimit) {
      // 每次 append 前同步读取并 expand 整个历史 JSONL 的话，长 session 的 rollout
      // 文件达到 GB 级时会在 UTF-8 转换/V8 字符串分配阶段 native crash。超限时直接重置为
      // 当前 bounded baseline，保证诊断日志不会威胁 agent 主流程。
      writeFileSync(filePath, line, "utf8");
    } else {
      appendFileSync(filePath, line, "utf8");
    }
    modelIOCompactionStates.set(filePath, buildModelIOCompactionState(preparedRecord));
  } catch {
    // Model I/O debug logging must never affect the model request path.
  }
}

export function prepareModelIORecordForWrite(
  record: Record<string, unknown>,
  isDev: boolean,
): Record<string, unknown> {
  if (isDev) {
    return record;
  }

  const request = asRecord(record.request);
  const response = asRecord(record.response);
  return {
    ...record,
    request: request ? prepareProductionRequestRecord(request, Boolean(record.error)) : request,
    response: response ? prepareProductionResponseRecord(response) : response,
  };
}

export function compactModelIORecord(
  record: Record<string, unknown>,
  previousState: ModelIOCompactionState | undefined,
  options: { maxBaselineMessages: number; preserveFullBodyMessages?: boolean },
): Record<string, unknown> {
  const request = asRecord(record.request);
  if (!request) {
    return record;
  }

  return {
    ...record,
    request: compactModelIORequest(request, previousState?.request, options),
  };
}

export function compactModelIORequest(
  request: Record<string, unknown>,
  previousState: ModelIORequestCompactionState | undefined,
  options: { maxBaselineMessages: number; preserveFullBodyMessages?: boolean },
): Record<string, unknown> {
  const next = { ...request };
  compactMessageCollection(
    next,
    previousState?.messages,
    {
      collectionKey: "messages",
      countKey: "messageCount",
      kindKey: "messagesKind",
      offsetKey: "messageOffset",
    },
    options,
  );
  compactMessageCollection(
    next,
    previousState?.sdkMessages,
    {
      collectionKey: "sdkMessages",
      countKey: "sdkMessageCount",
      kindKey: "sdkMessagesKind",
      offsetKey: "sdkMessageOffset",
    },
    options,
  );

  const body = asRecord(next.body);
  if (body) {
    const nextBody = { ...body };
    const bodyMessageKeys = {
      collectionKey: "messages",
      countKey: "bodyMessageCount",
      kindKey: "bodyMessagesKind",
      offsetKey: "bodyMessageOffset",
    };
    if (options.preserveFullBodyMessages && Array.isArray(nextBody.messages)) {
      // provider 400 等失败排障需要 exact request payload；失败记录若继续
      // 按上一条 model-io 做 delta，会把最关键的完整 messages 丢在导出包之外。
      next[bodyMessageKeys.countKey] = nextBody.messages.length;
      next[bodyMessageKeys.kindKey] = "full";
      next[bodyMessageKeys.offsetKey] = 0;
    } else {
      compactMessageCollection(
        nextBody,
        previousState?.bodyMessages,
        bodyMessageKeys,
        options,
        next,
      );
    }
    next.body = nextBody;
  }

  return next;
}

export function compactMessageCollection(
  target: Record<string, unknown>,
  previousState: ModelIOCollectionState | undefined,
  keys: {
    collectionKey: string;
    countKey: string;
    kindKey: string;
    offsetKey: string;
  },
  options: { maxBaselineMessages: number },
  metadataTarget: Record<string, unknown> = target,
): void {
  const currentMessages = target[keys.collectionKey];
  if (!Array.isArray(currentMessages)) {
    return;
  }

  metadataTarget[keys.countKey] = currentMessages.length;
  if (canStoreDeltaFromState(currentMessages, previousState)) {
    // 后续 model-io 只记录相对上一请求新增的消息，避免完整历史在同一 session 内梯度重复。
    // previousState 来自进程内缓存，不再为 append 同步读取并 expand 整个历史 JSONL。
    target[keys.collectionKey] = currentMessages.slice(previousState.count);
    metadataTarget[keys.kindKey] = "delta";
    metadataTarget[keys.offsetKey] = previousState.count;
    return;
  }

  const maxBaselineMessages = Math.max(1, options.maxBaselineMessages);
  if (currentMessages.length > maxBaselineMessages) {
    const offset = currentMessages.length - maxBaselineMessages;
    target[keys.collectionKey] = currentMessages.slice(offset);
    metadataTarget[keys.kindKey] = "tail";
    metadataTarget[keys.offsetKey] = offset;
    return;
  }

  metadataTarget[keys.kindKey] = "full";
  metadataTarget[keys.offsetKey] = 0;
}

export function canStoreDeltaFromState(
  currentMessages: unknown[],
  previousState: ModelIOCollectionState | undefined,
): previousState is ModelIOCollectionState {
  if (!previousState || previousState.count <= 0 || currentMessages.length < previousState.count) {
    return false;
  }
  const firstFingerprint = fingerprintValue(currentMessages[0]);
  const lastFingerprint = fingerprintValue(currentMessages[previousState.count - 1]);
  return (
    firstFingerprint === previousState.firstFingerprint &&
    lastFingerprint === previousState.lastFingerprint &&
    hasSameSampleFingerprints(currentMessages, previousState)
  );
}

export function hasSameSampleFingerprints(
  currentMessages: unknown[],
  previousState: ModelIOCollectionState,
): boolean {
  const previousSamples = previousState.sampleFingerprints;
  if (!previousSamples) {
    return true;
  }
  const currentSamples = fingerprintCollectionSamples(currentMessages, previousState.count);
  return (
    currentSamples.length === previousSamples.length &&
    currentSamples.every((fingerprint, index) => fingerprint === previousSamples[index])
  );
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
