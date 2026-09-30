import type {
  CreateFeedbackTicketInput,
  FeedbackAttachment,
  FeedbackAttachmentKind,
  FeedbackComment,
  FeedbackListQuery,
  FeedbackListResult,
  FeedbackTicketDetail,
} from "@mycode/shared";
import { ServiceChannels } from "@mycode/shared";
import { Event as RpcEvent, type Event } from "@mycode/rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface FeedbackUploadProgress {
  id: string;
  phase: "preparing" | "uploading" | "complete" | "canceled";
  uploadedBytes: number;
  totalBytes: number;
}

export interface FeedbackCreateOptions {
  operationId?: string;
}

export interface IFeedbackService {
  create(
    input: CreateFeedbackTicketInput,
    options?: FeedbackCreateOptions,
  ): Promise<FeedbackTicketDetail>;
  cancelCreate(operationId: string): Promise<void>;
  list(query?: FeedbackListQuery): Promise<FeedbackListResult>;
  get(id: string): Promise<FeedbackTicketDetail>;
  comment(id: string, body: string): Promise<FeedbackComment>;
  uploadAttachment(
    id: string,
    kind: FeedbackAttachmentKind,
    file: { path: string; filename?: string; contentType?: string; messageId?: string },
  ): Promise<FeedbackAttachment>;
  uploadAttachmentWithProgress(
    id: string,
    kind: FeedbackAttachmentKind,
    file: { path: string; filename?: string; contentType?: string; messageId?: string },
    progressId: string,
  ): Promise<FeedbackAttachment>;
  cancelUpload(progressId: string): Promise<void>;
  onDynamicUploadProgress(id: string): Event<FeedbackUploadProgress>;
  uploadAttachmentData(
    id: string,
    kind: FeedbackAttachmentKind,
    file: {
      dataBase64: string;
      filename: string;
      contentType: string;
      messageId?: string;
    },
  ): Promise<FeedbackAttachment>;
  attachLogsFromExport(id: string, options?: { full?: boolean }): Promise<FeedbackAttachment>;
  getDeviceSnapshot(): Promise<import("@mycode/shared").FeedbackDeviceInfo>;
  prepareCompactLogArchive(options?: { full?: boolean; progressId?: string }): Promise<{
    path: string;
    size: number;
  }>;
  cleanupPreparedLogArchive(path: string): Promise<void>;
  revealLogArchive(path: string): Promise<void>;
}

export const IFeedbackService = createServiceDescriptor<IFeedbackService>(ServiceChannels.Feedback);

export function createRemovedFeedbackService(): IFeedbackService {
  const removed = async (): Promise<never> => {
    throw new Error("Feedback integration has been removed");
  };
  return {
    create: removed,
    cancelCreate: removed,
    list: removed,
    get: removed,
    comment: removed,
    uploadAttachment: removed,
    uploadAttachmentWithProgress: removed,
    cancelUpload: removed,
    onDynamicUploadProgress: () => RpcEvent.None,
    uploadAttachmentData: removed,
    attachLogsFromExport: removed,
    getDeviceSnapshot: removed,
    prepareCompactLogArchive: removed,
    cleanupPreparedLogArchive: removed,
    revealLogArchive: removed,
  };
}
