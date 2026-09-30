import { useState, type RefObject } from "react";
import { ChevronDownIcon, RotateCcwIcon, ZapIcon } from "lucide-react";
import { TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER, type MyCodeConfigOption } from "@mycode/shared";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import {
  isCoarseTouchDevice,
  shouldRestoreChatInputFocusAfterPickerClose,
} from "@/lib/pickerFocus.js";
import { resolveThoughtSlider } from "./thoughtSliderOptions.js";
import { getThoughtLevelLabel } from "./thoughtLevelOptions.js";

export function ThoughtLevelSlider({
  option,
  modelLabel,
  disabled,
  open: controlledOpen,
  onOpenChange,
  onValueChange,
  triggerRef,
  shortcutLabel,
  restoreFocusSelector,
  composerCollapsePriority,
}: {
  option: MyCodeConfigOption;
  modelLabel: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: string) => void;
  triggerRef: RefObject<HTMLSpanElement | null>;
  shortcutLabel?: string;
  restoreFocusSelector?: string;
  composerCollapsePriority?: number;
}) {
  const { intl } = useMyCodeIntl();
  const state = resolveThoughtSlider(option);
  const [uncontrolledOpen, setOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const t = (key: string) => intl.formatMessage({ id: `chat.toolbar.strength.${key}` });
  const current = option.options?.find((entry) => entry.value === option.currentValue);
  const label = current ? getThoughtLevelLabel(intl, undefined, option, current) : t("choose");
  const index = state.selectedIndex < 0 ? state.levels.length - 1 : state.selectedIndex;
  const position = state.levels.length > 1 ? (index / (state.levels.length - 1)) * 100 : 100;
  if (!state.levels.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <ControlHintTooltip title={t("choose")} shortcut={shortcutLabel} triggerRef={triggerRef}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="group/thought h-8 gap-1 rounded-lg px-1.5 text-ui-sm text-foreground-subtle hover:bg-hover data-[composer-compact]:size-7 data-[composer-compact]:justify-center data-[composer-compact]:p-0"
            aria-label={t("choose")}
            data-testid={TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER}
            data-chat-toolbar-popover-trigger="true"
            data-composer-thought-control={composerCollapsePriority !== undefined || undefined}
            data-composer-collapse-priority={composerCollapsePriority}
          >
            <span className="group-data-[composer-compact]/thought:hidden">{label}</span>
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </ControlHintTooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-56 max-w-[calc(100vw-1.5rem)] gap-2 rounded-xl border-border bg-popover p-2.5 shadow-sm"
        aria-label={t("choose")}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusSelector) return;
          event.preventDefault();
          if (
            shouldRestoreChatInputFocusAfterPickerClose({
              isCoarseTouchDevice: isCoarseTouchDevice(),
            })
          )
            document.querySelector<HTMLElement>(restoreFocusSelector)?.focus();
        }}
      >
        <div className="flex items-start justify-between gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6 rounded-full text-foreground-subtle"
            disabled={disabled || !state.off}
            aria-label={state.enabled ? "no thinking" : "thinking"}
            aria-pressed={!state.enabled}
            title={state.enabled ? "no thinking" : "thinking"}
            onClick={() => {
              if (state.off && state.defaultValue)
                onValueChange(state.enabled ? state.off.value : state.defaultValue);
            }}
          >
            <ZapIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p
              className="text-ui-base font-medium text-[var(--color-reasoning-accent)]"
              aria-live="polite"
            >
              {state.isToggle
                ? state.enabled
                  ? "thinking"
                  : "no thinking"
                : state.enabled
                  ? current?.value
                  : "no thinking"}
            </p>
            <p className="mt-0.5 truncate text-ui-xs text-foreground-subtle" title={modelLabel}>
              {modelLabel}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6 rounded-full"
            disabled={disabled}
            aria-label={t("reset")}
            onClick={() => {
              if (state.defaultValue) onValueChange(state.defaultValue);
            }}
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </div>
        {state.isToggle ? (
          <div className="grid grid-cols-2 gap-0.5 rounded-full bg-hover p-0.5">
            {[state.off, ...state.levels]
              .filter((entry) => entry !== undefined)
              .map((entry) => (
                <Button
                  key={entry.value}
                  size="sm"
                  variant="ghost"
                  className={
                    entry.value === option.currentValue
                      ? "h-7 rounded-full bg-surface text-ui-sm text-foreground shadow-sm"
                      : "h-7 rounded-full text-ui-sm text-foreground-subtle"
                  }
                  aria-pressed={entry.value === option.currentValue}
                  disabled={disabled}
                  onClick={() => onValueChange(entry.value)}
                >
                  {entry === state.off ? "no thinking" : "thinking"}
                </Button>
              ))}
          </div>
        ) : (
          <>
            <div className="relative py-1">
              <input
                type="range"
                min={0}
                max={state.levels.length - 1}
                step={1}
                value={index}
                disabled={disabled}
                className="thought-strength-slider block w-full"
                style={{
                  background: `linear-gradient(to right, ${state.enabled ? "var(--color-reasoning-accent)" : "var(--color-hover)"} 0%, ${state.enabled ? "var(--color-reasoning-accent)" : "var(--color-hover)"} ${position}%, var(--color-hover) ${position}%, var(--color-hover) 100%)`,
                }}
                aria-label={t("choose")}
                aria-valuetext={state.enabled ? current?.value : "no thinking"}
                onChange={(event) => {
                  // 浏览器 range 只返回离散索引，始终发送该槽位的原始 Host 值。
                  const level = state.levels[Number(event.target.value)];
                  if (level) onValueChange(level.value);
                }}
              />
              <div
                className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between"
                aria-hidden="true"
              >
                {state.levels.map((entry) => (
                  <span key={entry.value} className="size-1.5 rounded-full bg-white/35" />
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
