import { isFileSystemPortError } from "../deps.js";
import type {
  FilePartSource,
  FileSystemPort,
  ImageProcessorPort,
  SessionId,
  ToolArtifactStorePort,
  TraceContext,
  TurnAttachment,
  TurnId,
} from "../deps.js";
import { INLINE_MEDIA_ATTACHMENT_MAX_BYTES } from "../types.js";
import type { PreparedImageData, ResolvedTurnAttachment } from "../types.js";
import { persistAttachmentDataUrl } from "./attachment-artifacts.js";
import { resolvedPlaceholderAttachment } from "./attachment-placeholder.js";
import { prepareImageDataUrl } from "./attachment-image.js";
import { isPdfBytes, PDF_INPUT_MAX_BYTES } from "./attachment-pdf.js";
import { resolvedPathReferenceAttachment } from "./attachment-path-reference.js";

export interface InlineMediaResolverOptions {
  abortSignal?: AbortSignal;
  artifactStore?: ToolArtifactStorePort;
  existingArtifactUri?: string;
  imageProcessorPort?: ImageProcessorPort;
  sessionId?: SessionId;
  traceContext: TraceContext;
  turnId?: TurnId;
}

export interface LocalMediaResolverOptions extends Omit<
  InlineMediaResolverOptions,
  "existingArtifactUri"
> {
  fileSystemPort: FileSystemPort;
  workingDirectory: string;
}

export interface LocalMediaContext {
  absolutePath: string;
  attachment: TurnAttachment;
  filename: string;
  index: number;
  mime: string;
  options: LocalMediaResolverOptions;
  source: FilePartSource;
  stat: Awaited<ReturnType<FileSystemPort["stat"]>>;
}

export async function resolveLocalPdfAttachment(
  context: LocalMediaContext,
): Promise<ResolvedTurnAttachment> {
  const { absolutePath, attachment, filename, mime, options, source, stat } = context;
  if (stat.sizeBytes > PDF_INPUT_MAX_BYTES) {
    return resolvedPathReferenceAttachment(attachment, attachment.path!, {
      filename,
      mime,
      sizeBytes: stat.sizeBytes,
      source,
      reason: "pdf_too_large",
    });
  }
  let read: Awaited<ReturnType<FileSystemPort["readBinaryFile"]>>;
  try {
    read = await options.fileSystemPort.readBinaryFile(
      { path: absolutePath, maxBytes: PDF_INPUT_MAX_BYTES, trace: options.traceContext },
      { signal: options.abortSignal },
    );
  } catch (error) {
    if (isFileSystemPortError(error) && error.code === "too_large") {
      return resolvedPathReferenceAttachment(attachment, attachment.path!, {
        filename,
        mime,
        source,
        reason: "pdf_too_large",
      });
    }
    return localMediaReadFailure(attachment, filename, mime, source);
  }
  if (read.bytesRead === 0 || !isPdfBytes(read.content)) {
    return resolvedPlaceholderAttachment(attachment, attachment.path!, "attachment_pdf_invalid", {
      filename,
      mime,
      sizeBytes: read.sizeBytes,
      source,
    });
  }
  const dataUrl = `data:${mime};base64,${Buffer.from(read.content).toString("base64")}`;
  const resource = await persistAttachmentDataUrl(dataUrl, context.index, mime, {
    abortSignal: options.abortSignal,
    artifactStore: options.artifactStore,
    sessionId: options.sessionId,
    traceContext: options.traceContext,
    turnId: options.turnId,
  });
  return {
    contentBlock: {
      type: "file",
      mediaType: mime,
      name: filename,
      dataUrl,
      source: {
        id: `turn-attachment-${context.index + 1}`,
        kind: "local_file",
        mimeType: mime,
        path: absolutePath,
        placeholder: attachment.path,
        sizeBytes: read.sizeBytes,
        sha256: read.revision?.hash,
        ...(resource.metadata.artifactUri ? { uri: resource.metadata.artifactUri } : {}),
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

export async function resolveLocalImageAttachment(
  context: LocalMediaContext,
): Promise<ResolvedTurnAttachment> {
  const { absolutePath, attachment, filename, index, mime, options, source, stat } = context;
  if (stat.sizeBytes > INLINE_MEDIA_ATTACHMENT_MAX_BYTES) {
    return resolvedPathReferenceAttachment(attachment, attachment.path!, {
      filename,
      mime,
      sizeBytes: stat.sizeBytes,
      source,
      reason: "image_too_large",
    });
  }
  let read: Awaited<ReturnType<FileSystemPort["readTextFile"]>>;
  try {
    read = await options.fileSystemPort.readTextFile(
      { path: absolutePath, encoding: "base64", trace: options.traceContext },
      { signal: options.abortSignal },
    );
  } catch {
    return localMediaReadFailure(attachment, filename, mime, source);
  }
  const dataUrl = `data:${mime};base64,${read.content}`;
  let prepared: PreparedImageData | undefined;
  try {
    prepared = await prepareImageDataUrl(dataUrl, mime, options);
  } catch {
    return resolvedPlaceholderAttachment(
      attachment,
      attachment.path!,
      "attachment_image_resize_failed",
      { filename, mime, sizeBytes: stat.sizeBytes, source },
    );
  }
  if (!prepared) {
    return resolvedPlaceholderAttachment(attachment, attachment.path!, "attachment_image_invalid", {
      filename,
      mime,
      sizeBytes: stat.sizeBytes,
      source,
    });
  }
  const resource = await persistAttachmentDataUrl(prepared.dataUrl, index, prepared.mediaType, {
    abortSignal: options.abortSignal,
    artifactStore: options.artifactStore,
    sessionId: options.sessionId,
    traceContext: options.traceContext,
    turnId: options.turnId,
  });
  return {
    contentBlock: {
      type: "image",
      mediaType: prepared.mediaType,
      dataUrl: prepared.dataUrl,
      source: {
        id: `turn-attachment-${index + 1}`,
        kind: "local_file",
        mimeType: prepared.mediaType,
        path: absolutePath,
        placeholder: attachment.path,
        sizeBytes: stat.sizeBytes,
        sha256: read.revision?.hash,
      },
    },
    filename,
    metadata: {
      ...(prepared.metadata ? { image: prepared.metadata } : {}),
      originalUrl: attachment.path,
      recoverability: resource.metadata.recoverability,
      sha256: read.revision?.hash,
      sizeBytes: stat.sizeBytes,
      storageKind: resource.metadata.storageKind,
      ...(resource.metadata.artifactUri ? { artifactUri: resource.metadata.artifactUri } : {}),
    },
    mime: prepared.mediaType,
    source,
    url: resource.url,
  };
}

export function localMediaReadFailure(
  attachment: TurnAttachment,
  filename: string,
  mime: string,
  source: FilePartSource,
): ResolvedTurnAttachment {
  return resolvedPlaceholderAttachment(attachment, attachment.path!, "attachment_read_failed", {
    filename,
    mime,
    source,
  });
}
