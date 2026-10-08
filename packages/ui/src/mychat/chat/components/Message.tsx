import { useEffect, useRef, useState } from "react";
import type {
  Attachment,
  ChatMessage,
  ResearchProgress,
  ResearchStep,
} from "@mycode/shared/mychat";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconGlobe,
  IconPencil,
  IconRefresh,
  IconSearch,
} from "./icons.js";
import { MarkdownView, stripMarkdown } from "../lib/markdown.js";
import { AttachmentImage, AttachmentList } from "./AttachmentControls.js";

type Props = {
  message: ChatMessage;
  streaming?: boolean;
  language?: "zh" | "en";
  onRegenerate?: () => void;
  onEdit?: (messageId: string, content: string, attachments?: Attachment[]) => void;
};

function formatDuration(sec: number, isZh = false): string {
  const wholeSeconds = Math.max(0, Math.floor(sec));
  if (isZh) {
    if (wholeSeconds < 60) return `${wholeSeconds}秒`;
    const minutes = Math.floor(wholeSeconds / 60);
    const rem = wholeSeconds % 60;
    return rem > 0 ? `${minutes}分${rem}秒` : `${minutes}分钟`;
  }
  if (wholeSeconds < 60) return `${wholeSeconds}s`;
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}m ${wholeSeconds % 60}s`;
}

function renderLiveStatusText(text: string) {
  return text.replace(/(\s*[.·…]+)+$/, "").trim();
}

function researchStepLabel(step: ResearchStep, isZh: boolean): string {
  const count = step.count ?? 0;
  if (step.kind === "search") {
    if (step.status === "active") {
      return step.detail
        ? isZh
          ? `正在搜索 “${step.detail}”`
          : `Searching “${step.detail}”`
        : isZh
          ? "正在搜索网页"
          : "Searching the web";
    }
    return step.detail
      ? isZh
        ? `已检索 “${step.detail}”`
        : `Searched “${step.detail}”`
      : isZh
        ? "已完成网页检索"
        : "Searched the web";
  }
  if (step.kind === "read") {
    if (step.status === "active")
      return isZh ? `正在读取 ${count} 个来源` : `Reading ${count} sources`;
    return isZh ? `已参考 ${count} 个来源` : `Referenced ${count} sources`;
  }
  return step.detail || "";
}

function ResearchTrace({
  progress,
  streaming,
  isZh,
}: {
  progress: ResearchProgress;
  streaming: boolean;
  isZh: boolean;
}) {
  const visibleSteps = progress.steps.filter((s) => s.kind === "search" || s.kind === "read");
  if (!visibleSteps.length) return null;

  return (
    <div className={`research-trace ${streaming ? "is-live" : "is-complete"}`}>
      {visibleSteps.map((step) => {
        const sites = step.sites || [];
        const isRead = step.kind === "read";
        const isDone = step.status === "done";
        const row = (
          <span className="research-step-heading">
            <span className={`research-step-icon ${step.kind} ${step.status}`}>
              {isDone ? (
                <IconCheck size={11} />
              ) : step.kind === "search" ? (
                <IconSearch size={12} />
              ) : (
                <IconGlobe size={12} />
              )}
            </span>
            <span className={step.status === "active" ? "thinking-shimmer" : undefined}>
              {researchStepLabel(step, isZh)}
            </span>
          </span>
        );
        if (!sites.length) {
          return (
            <div className={`research-step ${step.kind} ${step.status}`} key={step.id}>
              {row}
            </div>
          );
        }
        return (
          <details
            className={`research-step ${step.kind} ${step.status}`}
            key={step.id}
            open={streaming || isRead}
          >
            <summary title={step.detail}>
              {row}
              <span className="research-step-chevron">
                <IconChevronDown size={11} />
              </span>
            </summary>
            <div className="research-domains">
              {sites.map((site) => (
                <a
                  key={site.url}
                  href={site.url}
                  target="_blank"
                  rel="noreferrer"
                  title={site.title || site.domain}
                  className="research-source-chip"
                >
                  <IconGlobe size={11} />
                  <span className="source-domain">{site.domain || site.title}</span>
                </a>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function MessageView({ message, streaming, language, onRegenerate, onEdit }: Props) {
  const isZh =
    language === "zh" ||
    (typeof document !== "undefined" && document.documentElement.lang?.startsWith("zh"));
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(message.content);
  const copyReset = useRef<number | null>(null);

  useEffect(() => {
    setDraftText(message.content);
  }, [message.content]);

  useEffect(() => {
    if (!streaming || message.phase !== "thinking") return;
    const t0 = message.phaseStartedAt || Date.now();
    setSeconds(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - t0) / 1000));
    }, 200);
    return () => window.clearInterval(id);
  }, [streaming, message.id, message.phase, message.phaseStartedAt]);

  useEffect(
    () => () => {
      if (copyReset.current) window.clearTimeout(copyReset.current);
    },
    [],
  );

  const copy = async (textToCopy?: string): Promise<void> => {
    const rawText = textToCopy ?? message.content;
    const text = stripMarkdown(rawText);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const fallback = document.createElement("textarea");
        fallback.value = text;
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        const didCopy = document.execCommand("copy");
        fallback.remove();
        if (!didCopy) throw new Error("copy failed");
      }
      setCopied(true);
      if (copyReset.current) window.clearTimeout(copyReset.current);
      copyReset.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  if (message.role === "user") {
    const images = (message.attachments || []).filter(
      (f) => (f.kind === "image" || f.mime?.startsWith("image/")) && f.dataUrl,
    );
    const otherFiles = (message.attachments || []).filter(
      (f) => !((f.kind === "image" || f.mime?.startsWith("image/")) && f.dataUrl),
    );

    return (
      <div className="turn user-turn">
        {images.length > 0 && (
          <div className="user-attachments">
            {images.map((file) => (
              <AttachmentImage key={file.id} attachment={file} />
            ))}
          </div>
        )}

        {otherFiles.length > 0 && (
          <div className="user-attachments">
            <AttachmentList attachments={otherFiles} language={language} />
          </div>
        )}

        {isEditing ? (
          <div className="user-edit-box">
            <textarea
              className="user-edit-textarea"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draftText.trim() || (message.attachments && message.attachments.length > 0)) {
                    setIsEditing(false);
                    onEdit?.(message.id, draftText, message.attachments);
                  }
                } else if (e.key === "Escape") {
                  setIsEditing(false);
                  setDraftText(message.content);
                }
              }}
              autoFocus
            />
            <div className="user-edit-actions">
              <button
                type="button"
                className="user-edit-btn cancel"
                onClick={() => {
                  setDraftText(message.content);
                  setIsEditing(false);
                }}
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                className="user-edit-btn submit"
                disabled={
                  !draftText.trim() && (!message.attachments || message.attachments.length === 0)
                }
                onClick={() => {
                  setIsEditing(false);
                  onEdit?.(message.id, draftText, message.attachments);
                }}
              >
                {isZh ? "发送" : "Send"}
              </button>
            </div>
          </div>
        ) : message.content ? (
          <div className="user-bubble conversation-user-bubble">
            <div className="user-text">{message.content}</div>
          </div>
        ) : null}

        {!isEditing && (
          <div className="turn-actions user-turn-actions">
            {message.content ? (
              <button
                className="icon-btn ghost-icon message-action"
                type="button"
                title={copied ? (isZh ? "已复制" : "Copied") : isZh ? "复制" : "Copy"}
                aria-label={copied ? (isZh ? "已复制" : "Copied") : isZh ? "复制" : "Copy"}
                onClick={() => void copy(message.content)}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
            ) : null}
            {onEdit ? (
              <button
                className="icon-btn ghost-icon message-action"
                type="button"
                title={isZh ? "编辑" : "Edit"}
                aria-label={isZh ? "编辑" : "Edit"}
                onClick={() => {
                  setDraftText(message.content);
                  setIsEditing(true);
                }}
              >
                <IconPencil size={14} />
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const thinking = message.thinking.trim();
  const visibleThinking =
    thinking.length > 6000
      ? isZh
        ? `[已隐藏早期思考过程以提高渲染性能]\n\n${thinking.slice(-6000)}`
        : `[Earlier reasoning hidden to reduce rendering load]\n\n${thinking.slice(-6000)}`
      : thinking;
  const activelyThinking = Boolean(streaming && message.phase === "thinking");
  const showThought = Boolean(activelyThinking || (thinking && !streaming));
  const showLiveStatus = Boolean(streaming && !activelyThinking && message.statusText);
  const workedLabel = isZh
    ? `已深度思考 ${formatDuration(message.durationSeconds ?? 0, true)}`
    : `Thought for ${formatDuration(message.durationSeconds ?? 0, false)}`;
  const thinkingLabel = isZh
    ? `正在深度思考 ${formatDuration(seconds, true)}`
    : `Thinking ${formatDuration(seconds, false)}`;
  const thoughtBlock = showThought ? (
    <details
      className={`thought ${activelyThinking ? "is-thinking" : "is-complete"}`}
      open={activelyThinking || undefined}
    >
      <summary>
        <span className={activelyThinking ? "thinking-shimmer" : undefined}>
          {activelyThinking ? thinkingLabel : workedLabel}
        </span>
      </summary>
      {visibleThinking ? <pre>{visibleThinking}</pre> : null}
    </details>
  ) : !streaming && message.durationSeconds ? (
    <div className="worked-status">{workedLabel}</div>
  ) : null;

  if (!streaming && !showThought && !message.content) return null;

  return (
    <div className="turn assistant-turn">
      {!message.research ? thoughtBlock : null}
      {message.research ? (
        <ResearchTrace progress={message.research} streaming={Boolean(streaming)} isZh={isZh} />
      ) : null}
      {message.research ? thoughtBlock : null}
      {showLiveStatus ? (
        <div className={`assistant-live-status ${message.phase || "preparing"}`}>
          <span className="thinking-shimmer">{renderLiveStatusText(message.statusText!)}</span>
        </div>
      ) : null}
      <MarkdownView text={message.content} streaming={streaming} />
      {!streaming && message.content ? (
        <div className="turn-actions">
          <button
            className="icon-btn ghost-icon message-action"
            type="button"
            title={copied ? (isZh ? "已复制" : "Copied") : isZh ? "复制" : "Copy"}
            aria-label={copied ? (isZh ? "已复制" : "Copied") : isZh ? "复制" : "Copy"}
            onClick={() => void copy()}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
          {onRegenerate ? (
            <button
              className="icon-btn ghost-icon message-action"
              type="button"
              title={isZh ? "重新生成" : "Regenerate"}
              aria-label={isZh ? "重新生成" : "Regenerate"}
              onClick={onRegenerate}
            >
              <IconRefresh size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
