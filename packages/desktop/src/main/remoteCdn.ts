import { MYCODE_VERSION, type MyCodeEnv } from "@mycode/shared";

declare const __MYCODE_CDN_BASE_URL__: string | undefined;
const DEFAULT_CDN_BASE_URL = "";

export interface ResolveRemoteCdnOptions {
  env?: MyCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.MYCODE_CDN_BASE_URL?.trim() ||
    (typeof __MYCODE_CDN_BASE_URL__ === "undefined" ? "" : __MYCODE_CDN_BASE_URL__) ||
    DEFAULT_CDN_BASE_URL;
  if (!baseUrl) return [];
  return [
    `${normalizeBaseUrl(baseUrl)}/mycode/electron/releases/${options.version ?? MYCODE_VERSION}`,
  ];
}
