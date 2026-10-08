import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginStoreListing } from "@mycode/contracts";
import { MYCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@mycode/contracts";
import { DEFAULT_PLUGIN_MARKETPLACES } from "@mycode/shared";
import { isRecord, sanitizePluginId } from "./helpers.js";
import {
  type KnownMarketplaceRecord,
  readJsonFileSync,
  KNOWN_MARKETPLACES_FILE,
  MARKETPLACE_FILE,
  type MarketplaceSource,
  splitGitHubShorthand,
  type PluginMarketplaceManifest,
} from "./marketplace-marketplace-source.js";

export function loadKnownMarketplacesSync(storageRoot: string): KnownMarketplaceRecord[] {
  const parsed = readJsonFileSync(join(storageRoot, KNOWN_MARKETPLACES_FILE));
  if (!isRecord(parsed)) return [];
  const value = parsed.marketplaces;
  if (Array.isArray(value)) return value.filter(isKnownMarketplaceRecord);
  if (isRecord(value)) return Object.values(value).filter(isKnownMarketplaceRecord);
  return [];
}

export function ensureDefaultPluginMarketplaces(storageRoot: string): KnownMarketplaceRecord[] {
  const known = loadKnownMarketplacesSync(storageRoot);
  const officialIndex = known.findIndex(
    (record) => record.id === MYCODE_OFFICIAL_PLUGIN_MARKETPLACE,
  );
  let migrated = false;
  if (officialIndex >= 0) {
    const official = known[officialIndex];
    if (official && (official.source.source !== "bundled" || official.lastRefreshFailure)) {

      const { lastRefreshFailure: _retiredFailure, ...record } = official;
      known[officialIndex] = { ...record, source: { source: "bundled" } };
      migrated = true;
    }
  }
  const existingIds = new Set(known.map((record) => record.id));
  const now = new Date().toISOString();
  const missing = DEFAULT_PLUGIN_MARKETPLACES.filter(
    (marketplace) => !existingIds.has(marketplace.id),
  ).map(
    (marketplace): KnownMarketplaceRecord => ({
      id: marketplace.id,
      source: defaultMarketplaceSourceFromString(marketplace.source),
      name: marketplace.name,
      description: marketplace.description,
      addedAt: now,
      ...(marketplace.lastUpdated ? { lastUpdated: marketplace.lastUpdated } : {}),
      pluginCount: marketplace.pluginCount,
    }),
  );
  if (missing.length === 0 && !migrated) return known;
  const next = [...known, ...missing];
  writeKnownMarketplacesSync(storageRoot, next);
  return next;
}

export function getMarketplaceManifestPath(storageRoot: string, marketplace: string): string {
  return join(storageRoot, "marketplaces", sanitizePluginId(marketplace), MARKETPLACE_FILE);
}

export function writeKnownMarketplacesSync(
  storageRoot: string,
  marketplaces: KnownMarketplaceRecord[],
): void {
  const path = join(storageRoot, KNOWN_MARKETPLACES_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: 1,
        marketplaces,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function defaultMarketplaceSourceFromString(source: string): MarketplaceSource {
  const trimmed = source.trim();
  if (trimmed === "bundled") return { source: "bundled" };
  if (/^[^/]+\/[^/]+(?:[#@].+)?$/u.test(trimmed) && !trimmed.includes(":")) {
    const { ref, url } = splitGitHubShorthand(trimmed);
    return ref ? { source: "github", repo: url, ref } : { source: "github", repo: url };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { source: "url", url: trimmed };
  }
  return { source: "url", url: trimmed };
}

/**
 * 从目录条目解析可选的商店展示信息。兼容字符串或对象形式的 author、i18n map 和多值字段；
 * 解析不到有效内容时返回 undefined，避免给每个条目挂空对象。
 */
export function parseEntryStoreListing(
  entry: Record<string, unknown>,
): PluginStoreListing | undefined {
  const readString = (key: string): string | undefined => {
    const value = entry[key];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  };
  const readStringMap = (key: string): Record<string, string> | undefined => {
    const value = entry[key];
    if (!isRecord(value)) return undefined;
    const map: Record<string, string> = {};
    for (const [locale, text] of Object.entries(value)) {
      if (typeof text === "string") map[locale] = text;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  };
  const readStringListMap = (key: string): Record<string, string[]> | undefined => {
    const value = entry[key];
    if (!isRecord(value)) return undefined;
    const map: Record<string, string[]> = {};
    for (const [locale, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue;
      const items = list.filter((item): item is string => typeof item === "string");
      if (items.length > 0) map[locale] = items;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  };

  const listing: PluginStoreListing = {};
  const displayName = readString("displayName");
  if (displayName) listing.displayName = displayName;
  const displayNameI18n = readStringMap("displayName_i18n");
  if (displayNameI18n) listing.displayNameI18n = displayNameI18n;
  const descriptionI18n = readStringMap("description_i18n");
  if (descriptionI18n) listing.descriptionI18n = descriptionI18n;
  for (const key of [
    "icon",
    "category",
    "homepage",
    "privacyPolicy",
    "termsOfService",
    "heroImage",
  ] as const) {
    const value = readString(key);
    if (value) listing[key] = value;
  }
  const author = normalizeAuthorValue(entry.author);
  if (author?.name) listing.author = author.name;
  if (author?.url) listing.authorUrl = author.url;
  const examplePrompts = Array.isArray(entry.examplePrompts)
    ? entry.examplePrompts.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : undefined;
  if (examplePrompts && examplePrompts.length > 0) listing.examplePrompts = examplePrompts;
  const examplePromptsI18n = readStringListMap("examplePrompts_i18n");
  if (examplePromptsI18n) listing.examplePromptsI18n = examplePromptsI18n;
  // 付费套餐提示只认显式布尔 true；字符串 "true"、1 等歧义写法一律按无需套餐处理，
  // 避免目录写错就给免费插件挂上付费提示。
  return Object.keys(listing).length > 0 ? listing : undefined;
}

/** author 字段兼容 string 与 {name,url}（plugin.json 与目录条目共用此规则）。 */
export function normalizeAuthorValue(value: unknown): { name?: string; url?: string } | undefined {
  if (typeof value === "string") {
    const name = value.trim();
    return name.length > 0 ? { name } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!name && !url) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  };
}

export function normalizeDependencyRef(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/@\^[^@]*$/u, "");
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const marketplace = typeof value.marketplace === "string" ? value.marketplace.trim() : "";
  return marketplace ? `${name}@${marketplace}` : name;
}

export function isPluginMarketplaceManifest(value: unknown): value is PluginMarketplaceManifest {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.plugins) &&
    isRecord(value.raw)
  );
}

export function isKnownMarketplaceRecord(value: unknown): value is KnownMarketplaceRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.pluginCount === "number" &&
    isRecord(value.source)
  );
}
