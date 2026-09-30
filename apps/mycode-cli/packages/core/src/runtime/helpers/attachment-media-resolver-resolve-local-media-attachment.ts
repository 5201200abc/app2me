import { basename, isFileSystemPortError, resolvePath } from "../deps.js";
import { VIDEO_INPUT_MAX_BYTES } from "@mycode/contracts";
import type { FilePartSource, FileSystemPort, TurnAttachment } from "../deps.js";
import type { ResolvedTurnAttachment } from "../types.js";
import { persistAttachmentDataUrl } from "./attachment-artifacts.js";
import { resolvedPlaceholderAttachment } from "./attachment-placeholder.js";
import { inferImageMimeFromPath } from "./attachment-image.js";
import { inferVideoMimeFromPath } from "./attachment-video.js";
import { resolvedPathReferenceAttachment } from "./attachment-path-reference.js";
import {
  type LocalMediaResolverOptions,
  localMediaReadFailure,
  type LocalMediaContext,
  resolveLocalImageAttachment,
  resolveLocalPdfAttachment,
} from "./attachment-media-resolver-inline-media-resolver-options.js";

export async function resolveLocalMediaAttachment(
  attachment: TurnAttachment,
  index: number,
  options: LocalMediaResolverOptions,
): Promise<ResolvedTurnAttachment> {
  const attachmentPath = attachment.path!;
  const absolutePath = resolvePath(options.workingDirectory, attachmentPath);
  const filename = basename(absolutePath);
  const mime =
    attachment.type === "image"
      ? inferImageMimeFromPath(absolutePath)
      : attachment.type === "pdf"
        ? "application/pdf"
        : (inferVideoMimeFromPath(absolutePath) ?? attachment.mimeType ?? "video/mp4");
  const source: FilePartSource = {
    type: "file",
    path: absolutePath,
    text: { value: attachmentPath, start: 0, end: attachmentPath.length },
  };
  let stat: Awaited<ReturnType<FileSystemPort["stat"]>>;
  try {
    stat = await options.fileSystemPort.stat(
      { path: absolutePath, trace: options.traceContext },
      { signal: options.abortSignal },
    );
  } catch {
    return localMediaReadFailure(attachment, filename, mime, source);
  }
  if (stat.kind !== "file") {
    return resolvedPlaceholderAttachment(attachment, attachmentPath, "attachment_not_file", {
      filename,
      mime,
      sizeBytes: stat.sizeBytes,
      source,
    });
  }

  const context: LocalMediaContext = {
    absolutePath,
    attachment,
    filename,
    index,
    mime,
    options,
    source,
    stat,
  };
  if (attachment.type === "image") return resolveLocalImageAttachment(context);
  if (attachment.type === "pdf") return resolveLocalPdfAttachment(context);
  return resolveLocalVideoAttachment(context);
}

export async function resolveLocalVideoAttachment(
  context: LocalMediaContext,
): Promise<ResolvedTurnAttachment> {
  const { absolutePath, attachment, filename, index, mime, options, source, stat } = context;
  if (stat.sizeBytes > VIDEO_INPUT_MAX_BYTES) {
    return resolvedPathReferenceAttachment(attachment, attachment.path!, {
      filename,
      mime,
      sizeBytes: stat.sizeBytes,
      source,
      reason: "video_too_large",
    });
  }
  let read: Awaited<ReturnType<FileSystemPort["readBinaryFile"]>>;
  try {
    read = await options.fileSystemPort.readBinaryFile(
      { path: absolutePath, maxBytes: VIDEO_INPUT_MAX_BYTES, trace: options.traceContext },
      { signal: options.abortSignal },
    );
  } catch (error) {
    if (isFileSystemPortError(error) && error.code === "too_large") {
      // 外层 stat 后文件仍可能增长；以读取端的 maxBytes 结果为最终边界。
      return resolvedPathReferenceAttachment(attachment, attachment.path!, {
        filename,
        mime,
        source,
        reason: "video_too_large",
      });
    }
    return localMediaReadFailure(attachment, filename, mime, source);
  }
  // 文件可能在 stat 后被清空，必须以实际读取结果判断是否为有效视频。
  if (read.bytesRead === 0) {
    return resolvedPlaceholderAttachment(attachment, attachment.path!, "attachment_video_invalid", {
      filename,
      mime,
      sizeBytes: read.sizeBytes,
      source,
    });
  }
  const dataUrl = `data:${mime};base64,${Buffer.from(read.content).toString("base64")}`;
  const resource = await persistAttachmentDataUrl(dataUrl, index, mime, {
    abortSignal: options.abortSignal,
    artifactStore: options.artifactStore,
    sessionId: options.sessionId,
    traceContext: options.traceContext,
    turnId: options.turnId,
  });
  return {
    contentBlock: {
      type: "video",
      mediaType: mime,
      dataUrl,
      source: {
        id: `turn-attachment-${index + 1}`,
        kind: "local_file",
        mimeType: mime,
        path: absolutePath,
        placeholder: attachment.path,
        sizeBytes: read.sizeBytes,
        sha256: read.revision?.hash,
      },
    },
    filename,
    metadata: {
      originalUrl: attachment.path,
      recoverability: resource.metadata.recoverability,
      sha256: read.revision?.hash,
      sizeBytes: read.sizeBytes,
      storageKind: resource.metadata.storageKind,
      ...(resource.metadata.artifactUri ? { artifactUri: resource.metadata.artifactUri } : {}),
    },
    mime,
    source,
    url: resource.url,
  };
}
