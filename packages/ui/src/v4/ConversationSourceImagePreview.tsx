import { useEffect, useState } from "react";
import { ImagePreviewDialog } from "@/components/ai-elements/image-preview-dialog.js";
import type { ConversationInventoryItem } from "@/v4/conversationInventoryModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

export function ConversationSourceImagePreview({
  item,
  context,
  onClose,
}: {
  item: ConversationInventoryItem;
  context: ConversationRowRenderContext;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<{ url?: string; loading?: boolean; error?: boolean }>({
    loading: true,
  });
  const read = context.readAttachment,
    sessionId = context.sessionId;
  useEffect(() => {
    if (item.thumbnail) {
      setPreview({ url: item.thumbnail });
      return;
    }
    if (!item.ref || !read || !sessionId) {
      setPreview({ error: true });
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview({ loading: true });
    void read({ sessionId, ref: item.ref, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        objectUrl =
          "url" in result
            ? undefined
            : URL.createObjectURL(
                new Blob([Uint8Array.from(result.bytes)], { type: result.mediaType }),
              );
        setPreview({ url: "url" in result ? result.url : objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ error: true });
      });
    return () => {
      // 原先复用了整条消息布局；这里只读所选 ref，关闭/换源必须取消并回收临时 URL。
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.ref, item.thumbnail, read, sessionId, context.logEpoch]);
  return (
    <ImagePreviewDialog
      dialogTestId="conversation-source-image-preview"
      imageTestId="conversation-source-preview-image"
      initialIndex={0}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      items={[
        {
          alt: item.label,
          filename: item.label,
          mediaType: item.mime ?? "image/png",
          src: preview.url,
          loading: preview.loading,
          error: preview.error,
        },
      ]}
    />
  );
}

export function isImageSource(
  item: ConversationInventoryItem | null,
): item is ConversationInventoryItem & { kind: "screenshot" } {
  return Boolean(
    item?.kind === "screenshot" && (item.thumbnail || item.mime?.startsWith("image/")),
  );
}
