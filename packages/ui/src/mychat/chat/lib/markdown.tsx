import { MessageResponse } from "@/components/ai-elements/message.js";
import { useMyCodeStore } from "@/store/StoreProvider.js";

export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const theme = useMyCodeStore((state) => state.theme);
  if (!text) return null;
  return (
    <MessageResponse
      className="conversation-answer text-ui-base font-normal leading-normal tracking-normal"
      streaming={streaming}
      theme={theme}
    >
      {text}
    </MessageResponse>
  );
}

export function stripMarkdown(md: string): string {
  if (!md) return "";
  let text = md;
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");
  // Fenced code blocks: keep inner content without ```
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, "$1");
  // Inline code
  text = text.replace(/`([^`]+)`/g, "$1");
  // Images: ![alt](url) -> alt
  text = text.replace(/!\[(.*?)\]\([^)]*\)/g, "$1");
  // Links: [text](url) -> text
  text = text.replace(/\[(.*?)\]\([^)]*\)/g, "$1");
  // Headers: # Header -> Header
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  // Bold & Italic: ***text***, **text**, *text*, __text__, _text_
  text = text.replace(/(\*{1,3}|_{1,3})((?:[^*_]|\\\*|\\_)+?)\1/g, "$2");
  // Strikethrough ~~text~~ -> text
  text = text.replace(/~~(.*?)~~/g, "$1");
  // Blockquotes: > quote -> quote
  text = text.replace(/^>\s+/gm, "");
  // Horizontal rules: --- or ***
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  // Clean up excess blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
