import { getMyCodeCopy, type SupportedLocale, type UiLocale } from "@mycode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getMyCodeCopy(locale, detectedLocale).cli.help(version);
}
