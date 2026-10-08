import { cn } from "@/components/lib/utils.js";
import { useEffect, useRef } from "react";
import type { Attachment, Effort, Language, ReasoningControl } from "@mycode/shared/mychat";
import { IconArrowUp, IconStop } from "./icons.js";
import { ModelPicker } from "./ModelPicker.js";
import { AttachmentAddButton, AttachmentList, readDroppedFiles } from "./AttachmentControls.js";

type Props = {
  disabled?: boolean;
  className?: string;
  value: string;
  model: string;
  models: string[];
  effort: Effort;
  webSearch: boolean;
  streaming: boolean;
  attachments: Attachment[];
  language?: Language;
  onChange: (v: string) => void;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
  reasoningControl: ReasoningControl;
  reasoningEfforts?: Effort[];
  onWebSearch: (v: boolean) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: (files: Attachment[]) => void;
  onRemove: (id: string) => void;
};

export function Composer(props: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const isZh = (props.language ?? "en") === "zh";

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, 44), 240);
    el.style.height = `${next}px`;
  }, [props.value]);

  return (
    <div className={cn("composer-wrap", props.className)}>
      <div
        className="composer"
        data-prompt-editor-shell="true"
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("drop");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("drop")}
        onDrop={async (e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("drop");
          if (e.dataTransfer.files.length)
            props.onAttach(await readDroppedFiles(e.dataTransfer.files));
        }}
      >
        <AttachmentList
          attachments={props.attachments}
          onRemove={props.onRemove}
          language={props.language}
        />
        <textarea
          disabled={props.disabled}
          ref={area}
          rows={1}
          placeholder={isZh ? "向 MyChat 提问..." : "Ask MyChat..."}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onPaste={async (e) => {
            const files = Array.from(e.clipboardData.items)
              .map((i) => i.getAsFile())
              .filter((f): f is File => Boolean(f && f.type.startsWith("image/")));
            if (files.length) {
              e.preventDefault();
              props.onAttach(await readDroppedFiles(files));
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            props.onSend();
          }}
        />
        <div className="composer-bar">
          <div className="left-tools">
            <AttachmentAddButton
              attachments={props.attachments}
              onAdd={props.onAttach}
              onRemove={props.onRemove}
              language={props.language}
              disabled={props.disabled}
              webSearch={props.webSearch}
              onWebSearch={props.onWebSearch}
            />
            <ModelPicker
              disabled={props.disabled}
              model={props.model}
              models={props.models}
              effort={props.effort}
              language={props.language}
              onModel={props.onModel}
              onEffort={props.onEffort}
              reasoningControl={props.reasoningControl}
              reasoningEfforts={props.reasoningEfforts}
            />
          </div>
          <div className="right-tools">
            {props.streaming ? (
              <button
                className="send stop"
                type="button"
                onClick={props.onStop}
                aria-label={isZh ? "停止生成" : "Stop"}
                title={isZh ? "停止生成" : "Stop"}
              >
                <IconStop />
              </button>
            ) : (
              <button
                className="send"
                type="button"
                disabled={props.disabled || (!props.value.trim() && props.attachments.length === 0)}
                onClick={props.onSend}
                aria-label={isZh ? "发送" : "Send"}
                title={isZh ? "发送" : "Send"}
              >
                <IconArrowUp />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
