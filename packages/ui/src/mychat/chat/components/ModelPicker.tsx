import { ChevronDown, ChevronLeft } from "@/components/icons/tabler.js";
import { ModelLogo } from "@/components/ModelLogo.js";
import { resolveModelFamilyLogo } from "@/lib/modelFamilyLogo.js";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Effort, Language, ReasoningControl } from "@mycode/shared/mychat";
import { IconChevronRight, IconCheck } from "./icons.js";

type Page = "root" | "model";

const EFFORT_CONFIG: Record<
  Effort,
  {
    enLabel: string;
    zhLabel: string;
    enTitle: string;
    zhTitle: string;
    intensity: "none" | "low" | "med" | "high" | "max";
  }
> = {
  none: {
    enLabel: "none",
    zhLabel: "无思考",
    enTitle: "Thinking: Off (none)",
    zhTitle: "关闭思考 (none)",
    intensity: "none",
  },
  minimal: {
    enLabel: "minimal",
    zhLabel: "微弱思考",
    enTitle: "Thinking: Minimal",
    zhTitle: "微弱思考 (minimal)",
    intensity: "low",
  },
  low: {
    enLabel: "low",
    zhLabel: "轻度思考",
    enTitle: "Thinking: Low",
    zhTitle: "轻度思考 (low)",
    intensity: "low",
  },
  medium: {
    enLabel: "medium",
    zhLabel: "中度思考",
    enTitle: "Thinking: Medium",
    zhTitle: "中度思考 (medium)",
    intensity: "med",
  },
  high: {
    enLabel: "high",
    zhLabel: "深度思考",
    enTitle: "Thinking: High",
    zhTitle: "深度思考 (high)",
    intensity: "high",
  },
  xhigh: {
    enLabel: "xhigh",
    zhLabel: "极限思考",
    enTitle: "Thinking: Extra High (xhigh)",
    zhTitle: "极限思考 (xhigh)",
    intensity: "max",
  },
  max: {
    enLabel: "max",
    zhLabel: "最大思考",
    enTitle: "Thinking: Maximum",
    zhTitle: "最大思考 (max)",
    intensity: "max",
  },
};

function getEffortInfo(id: Effort) {
  return (
    EFFORT_CONFIG[id] ?? {
      enLabel: id,
      zhLabel: id,
      enTitle: `Thinking: ${id}`,
      zhTitle: `思考: ${id}`,
      intensity: "med" as const,
    }
  );
}

type Props = {
  disabled?: boolean;
  model: string;
  models: string[];
  effort: Effort;
  language?: Language;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
  reasoningControl?: ReasoningControl;
  reasoningEfforts?: Effort[];
};

const DEFAULT_EFFORTS: Effort[] = ["none", "low", "medium", "xhigh"];
const TRACK_WIDTH = 88;
const KNOB_SIZE = 12;
const TRACK_PAD = 3;
const TRAVEL_RANGE = TRACK_WIDTH - TRACK_PAD * 2 - KNOB_SIZE; // 70px

export function ModelPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>("root");
  const [pos, setPos] = useState({ right: 0, bottom: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const isZh = props.language === "zh";
  const models = props.models;
  const supportedEfforts =
    props.reasoningEfforts && props.reasoningEfforts.length > 0
      ? props.reasoningEfforts
      : DEFAULT_EFFORTS;

  const currentEffortIndex = Math.max(
    0,
    supportedEfforts.indexOf(props.effort) !== -1 ? supportedEfforts.indexOf(props.effort) : 0,
  );

  const stepsCount = supportedEfforts.length;
  const stepDivider = Math.max(1, stepsCount - 1);
  const knobLeft = TRACK_PAD + (currentEffortIndex / stepDivider) * TRAVEL_RANGE;
  const fillWidth = TRACK_PAD + KNOB_SIZE / 2 + (currentEffortIndex / stepDivider) * TRAVEL_RANGE;

  const activeEffortInfo = getEffortInfo(props.effort);

  const place = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      right: window.innerWidth - r.right,
      bottom: window.innerHeight - r.top + 8,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setPage("root");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    track.setPointerCapture(e.pointerId);
    setIsDragging(true);

    const updateFromClientX = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const rawX = clientX - rect.left;
      const innerX = rawX - (TRACK_PAD + KNOB_SIZE / 2);
      const ratio = Math.max(0, Math.min(1, innerX / TRAVEL_RANGE));
      const nearestIdx = Math.round(ratio * stepDivider);
      const next = supportedEfforts[nearestIdx];
      if (next && next !== props.effort) {
        props.onEffort(next);
      }
    };

    updateFromClientX(e.clientX);

    const onPointerMove = (moveEv: PointerEvent) => {
      updateFromClientX(moveEv.clientX);
    };

    const onPointerUp = (upEv: PointerEvent) => {
      try {
        track.releasePointerCapture(upEv.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", onPointerUp);
      track.removeEventListener("pointercancel", onPointerUp);
    };

    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerUp);
    track.addEventListener("pointercancel", onPointerUp);
  };

  const handleSliderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = Math.min(stepsCount - 1, currentEffortIndex + 1);
      props.onEffort(supportedEfforts[nextIdx] ?? props.effort);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const prevIdx = Math.max(0, currentEffortIndex - 1);
      props.onEffort(supportedEfforts[prevIdx] ?? props.effort);
    } else if (e.key === "Home") {
      e.preventDefault();
      props.onEffort(supportedEfforts[0] ?? props.effort);
    } else if (e.key === "End") {
      e.preventDefault();
      props.onEffort(supportedEfforts[stepsCount - 1] ?? props.effort);
    }
  };

  return (
    <div className="picker" ref={root}>
      <button
        className="picker-trigger"
        type="button"
        disabled={props.disabled}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) place();
            return next;
          });
          setPage("root");
        }}
      >
        <ModelLogo logo={resolveModelFamilyLogo(props.model, undefined)} className="size-4" />
        <span className="picker-model-name">
          {props.model || (isZh ? "未选择模型" : "No model")}
        </span>
        {props.reasoningControl === "toggle" ? (
          props.effort !== "low" ? (
            <span className="picker-effort-tag">{isZh ? "思考" : "thinking"}</span>
          ) : null
        ) : props.reasoningControl === "effort" ? (
          <span className="picker-effort-tag">
            {isZh ? activeEffortInfo.zhLabel : activeEffortInfo.enLabel}
          </span>
        ) : null}
        <ChevronDown className={`chev ${open ? "up" : ""}`} size={10} aria-hidden />
      </button>

      {open && (
        <div className="picker-panel" style={{ right: pos.right, bottom: pos.bottom }}>
          {page === "root" && (
            <div className="picker-content">
              {/* Models Row */}
              <button
                className="picker-row picker-model-row"
                type="button"
                onClick={() => setPage("model")}
              >
                <span className="picker-label">{isZh ? "模型" : "Models"}</span>
                <span className="picker-val">
                  <IconChevronRight size={12} />
                </span>
              </button>

              <div className="picker-section-divider" />

              {/* Reasoning Effort / Dynamic Slider Row */}
              {props.reasoningControl === "effort" && (
                <div
                  className="picker-row picker-slider-row"
                  role="group"
                  aria-label={isZh ? "深度思考调节条" : "Thinking Effort Slider"}
                >
                  <span className="picker-label">{isZh ? "深度思考" : "Thinking"}</span>
                  <div
                    className={`picker-slider-track ${isDragging ? "dragging" : ""} intensity-${activeEffortInfo.intensity}`}
                    ref={trackRef}
                    role="slider"
                    tabIndex={0}
                    aria-valuemin={0}
                    aria-valuemax={stepsCount - 1}
                    aria-valuenow={currentEffortIndex}
                    aria-valuetext={isZh ? activeEffortInfo.zhTitle : activeEffortInfo.enTitle}
                    onPointerDown={handleSliderPointerDown}
                    onKeyDown={handleSliderKeyDown}
                  >
                    {/* Active Vivid Dynamic Energy Fill Beam */}
                    <div
                      className={`picker-slider-fill fill-${activeEffortInfo.intensity}`}
                      style={{ width: `${fillWidth}px` }}
                    />
                    {/* Subtle Micro-Ticks */}
                    {supportedEfforts.map((step, idx) => {
                      const tickCenter =
                        TRACK_PAD + KNOB_SIZE / 2 + (idx / stepDivider) * TRAVEL_RANGE;
                      const isPassed = idx <= currentEffortIndex;
                      const isCurrent = idx === currentEffortIndex;
                      const stepInfo = getEffortInfo(step);
                      return (
                        <span
                          key={step}
                          className={`picker-slider-tick ${isPassed ? "active" : ""} ${isCurrent ? "current" : ""}`}
                          style={{ left: `${tickCenter}px` }}
                          title={isZh ? stepInfo.zhTitle : stepInfo.enTitle}
                        />
                      );
                    })}
                    {/* Living Magnetic Tactile Knob with dynamic halo */}
                    <div
                      className={`picker-slider-knob knob-${activeEffortInfo.intensity}`}
                      style={{ left: `${knobLeft}px` }}
                    >
                      <div className={`picker-knob-core core-${activeEffortInfo.intensity}`} />
                    </div>
                  </div>
                </div>
              )}

              {/* Toggle Thinking Row */}
              {props.reasoningControl === "toggle" && (
                <div
                  className="picker-row picker-toggle-row"
                  role="switch"
                  aria-checked={props.effort !== "low"}
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onEffort(props.effort === "low" ? "xhigh" : "low");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onEffort(props.effort === "low" ? "xhigh" : "low");
                    }
                  }}
                >
                  <span className="picker-label">{isZh ? "深度思考" : "Thinking"}</span>
                  <div className={`picker-switch ${props.effort !== "low" ? "on" : "off"}`}>
                    <div className="picker-switch-knob" />
                  </div>
                </div>
              )}

              {/* Disabled / None Row */}
              {props.reasoningControl === "none" && (
                <div className="picker-row picker-disabled-row">
                  <span className="picker-label">{isZh ? "深度思考" : "Thinking"}</span>
                  <span className="picker-dim-tag">{isZh ? "不支持" : "Off"}</span>
                </div>
              )}
            </div>
          )}

          {page === "model" && (
            <div className="picker-content">
              <button
                className="picker-row picker-back-row"
                type="button"
                onClick={() => setPage("root")}
              >
                <ChevronLeft className="picker-back-icon" size={10} aria-hidden />
              </button>
              <div className="picker-scroll-list">
                {models.length === 0 ? (
                  <div className="picker-empty-hint">
                    {isZh ? "无可用模型" : "No models available"}
                  </div>
                ) : (
                  models.map((id) => (
                    <button
                      key={id}
                      className={`picker-row picker-sub-row ${id === props.model ? "active" : ""}`}
                      type="button"
                      onClick={() => {
                        props.onModel(id);
                        setPage("root");
                      }}
                    >
                      <span className="picker-model-name-text" title={id}>
                        {id}
                      </span>
                      {id === props.model && <IconCheck size={13} />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
