import { DEFAULT_MYCODE_ENDPOINT_ORIGIN } from "./mycodeEndpoint.js";

export const MYCODE_SOURCE_HEADERS = {
  "User-Agent": "MyCode/unknown",
  "HTTP-Referer": DEFAULT_MYCODE_ENDPOINT_ORIGIN,
  "X-Title": "MyCode@electron",
} as const;

export interface BuildMyCodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeMyCodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildMyCodeSourceHeadersFromContext(
  options: BuildMyCodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeMyCodeSourceHeaderValue(options.appVersion);
  const arch = normalizeMyCodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeMyCodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeMyCodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeMyCodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeMyCodeSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_MYCODE_ENDPOINT_ORIGIN;
  const osVersion = normalizeMyCodeSourceHeaderValue(options.osVersion);
  const platform = normalizeMyCodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeMyCodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeMyCodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...MYCODE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `MyCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-MyCode-App-Version": appVersion } : {}),
    "X-Title": `MyCode@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
