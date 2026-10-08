import type { Attachment } from "@mycode/shared/mychat";

async function compactImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return dataUrl;
  }
}

export async function compactVisualAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.kind !== "image" && attachment.kind !== "video") return attachment;
      return {
        ...attachment,
        dataUrl: attachment.dataUrl ? await compactImage(attachment.dataUrl) : undefined,
        frames: attachment.frames
          ? await Promise.all(attachment.frames.map(compactImage))
          : undefined,
      };
    }),
  );
}
