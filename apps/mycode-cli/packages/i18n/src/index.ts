import type { UiLocale, SupportedLocale } from "@mycode/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { MyCodeCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, MyCodeCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, MyCodeCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getMyCodeCopy(locale?: UiLocale | string, detected?: string | null): MyCodeCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
