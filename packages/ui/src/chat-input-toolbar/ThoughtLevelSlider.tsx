import { useCallback, useState, type CSSProperties, type RefObject } from "react";
import { ChevronDownIcon, RotateCcwIcon, ZapIcon } from "@/components/icons/tabler.js";
import { TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER, type MyCodeConfigOption } from "@mycode/shared";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu.js";
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
  disabled,
  open: controlledOpen,
  onOpenChange,
  onValueChange,
  triggerRef,
  shortcutLabel,
  restoreFocusSelector,
  composerCollapsePriority,
  presentation = "popover",
}: {
  option: MyCodeConfigOption;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: string) => void;
  triggerRef?: RefObject<HTMLSpanElement | null>;
  shortcutLabel?: string;
  restoreFocusSelector?: string;
  composerCollapsePriority?: number;
  presentation?: "popover" | "model-menu";
}) {
  const { intl } = useMyCodeIntl();
  const state = resolveThoughtSlider(option);
  const [uncontrolledOpen, setOpen] = useState(false);
  const focusMenuControls = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLInputElement>('input[type="range"]')?.focus();
  }, []);
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
  const controls = (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        // 菜单的方向键导航会抢走 range 的原生按键；只隔离滑杆的编辑键，Escape 仍交给菜单。
        if (
          event.target instanceof HTMLInputElement &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(
            event.key,
          )
        )
          event.stopPropagation();
      }}
    >
      <div className="flex h-6 items-center justify-between gap-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-5 rounded-full text-foreground-subtle"
          data-strength-action="toggle"
          disabled={disabled || !state.off}
          aria-label={state.enabled ? "no thinking" : "thinking"}
          aria-pressed={!state.enabled}
          title={state.enabled ? "no thinking" : "thinking"}
          onClick={() => {
            if (state.off && state.defaultValue)
              onValueChange(state.enabled ? state.off.value : state.defaultValue);
          }}
        >
          <ZapIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p
            className="text-ui-sm font-medium transition-colors duration-180 motion-reduce:transition-none"
            style={{ color: state.color }}
            data-strength-value
            aria-live="polite"
          >
            {state.isToggle
              ? state.enabled
                ? "thinking"
                : "no thinking"
              : state.enabled
                ? label
                : "no thinking"}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-5 rounded-full text-foreground-subtle"
          data-strength-action="reset"
          disabled={disabled}
          aria-label={t("reset")}
          onClick={() => {
            if (state.defaultValue) onValueChange(state.defaultValue);
          }}
        >
          <RotateCcwIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
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
          <div className="relative mx-1 py-2">
            <input
              type="range"
              min={0}
              max={state.levels.length - 1}
              step={1}
              value={index}
              disabled={disabled}
              className="thought-strength-slider block w-full"
              style={
                {
                  "--thought-strength-color": state.color,
                  "--thought-strength-position": `${state.enabled ? position : 0}%`,
                } as CSSProperties
              }
              aria-label={t("choose")}
              aria-valuetext={state.enabled ? current?.value : "no thinking"}
              onChange={(event) => {
                // 浏览器 range 只返回离散索引，始终发送该槽位的原始 Host 值。
                const level = state.levels[Number(event.target.value)];
                if (level) onValueChange(level.value);
              }}
            />
            <div
              className="pointer-events-none absolute inset-x-1.5 top-1/2 flex -translate-y-1/2 justify-between"
              aria-hidden="true"
            >
              {state.levels.map((entry) => (
                <span
                  key={entry.value}
                  className="size-0.5 rounded-full bg-foreground-subtlest/50"
                  data-strength-tick
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
  if (presentation === "model-menu")
    return (
      <>
        <DropdownMenuItem
          disabled={disabled}
          data-testid={TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER}
          aria-label={t("choose")}
          aria-expanded={uncontrolledOpen}
          title={shortcutLabel ? `${t("choose")} (${shortcutLabel})` : t("choose")}
          className="gap-2 text-ui-caption font-normal [&>svg]:size-3"
          onSelect={(event) => {
            event.preventDefault();
            setOpen((value) => !value);
          }}
        >
          <span className="flex-1">{t("choose")}</span>
          <ThoughtLevelSummary option={option} />
          <ChevronDownIcon className={uncontrolledOpen ? "rotate-180" : undefined} />
        </DropdownMenuItem>
        {uncontrolledOpen ? (
          <div
            className="px-2 pb-1 pt-0.5"
            aria-label={t("choose")}
            data-testid="thought-strength-popover"
            ref={focusMenuControls}
          >
            {/* 目录两侧不足时水平子菜单会越界；沿用目录自身的宽度和视口滚动边界。 */}
            {controls}
          </div>
        ) : null}
      </>
    );
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
            {/* 档位标签长短不同会触发工具栏重新挤压和 Popover 重新定位；用目录标签预留同一宽度。 */}
            <span className="grid group-data-[composer-compact]/thought:hidden">
              {option.options?.map((entry) => (
                <span
                  key={entry.value}
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 select-none whitespace-nowrap"
                >
                  {getThoughtLevelLabel(intl, undefined, option, entry)}
                </span>
              ))}
              <span className="col-start-1 row-start-1 whitespace-nowrap">{label}</span>
            </span>
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </ControlHintTooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-44 max-w-[calc(100vw-1.5rem)] gap-2 rounded-xl border-popover-border bg-popover p-2 shadow-sm"
        aria-label={t("choose")}
        data-testid="thought-strength-popover"
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
        {controls}
      </PopoverContent>
    </Popover>
  );
}

/** 单一展示投影；所有标签预留同一宽度，档位变化不能挤动统一模型按钮。 */
export function ThoughtLevelSummary({
  option,
  className = "",
}: {
  option: MyCodeConfigOption;
  className?: string;
}) {
  const { intl } = useMyCodeIntl();
  const current = option.options?.find((entry) => entry.value === option.currentValue);
  return (
    <span
      data-composer-thought-summary
      className={`grid shrink-0 whitespace-nowrap text-ui-sm text-foreground-subtle ${className}`}
    >
      {option.options?.map((entry) => (
        <span
          key={entry.value}
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 select-none"
        >
          {getThoughtLevelLabel(intl, undefined, option, entry)}
        </span>
      ))}
      <span className="col-start-1 row-start-1">
        {current
          ? getThoughtLevelLabel(intl, undefined, option, current)
          : intl.formatMessage({ id: "chat.toolbar.strength.choose" })}
      </span>
    </span>
  );
}
