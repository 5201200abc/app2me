import type { MyCodePluginStoreListing } from "./mycode-protocol/index.js";
import {
  MYCODE_NODE_REPL_HOST_PLUGIN_ID,
  MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
} from "./plugin-marketplaces.js";

/** 官方目录种子和界面共用，避免已有目录缓存继续显示旧说明。 */
export const OFFICIAL_PLUGIN_DESCRIPTIONS_ZH_CN = {
  nodeReplHost:
    "MyCode 官方功能共用的 Node 运行环境（node_repl，运行 JavaScript 的交互环境）。不是给用户直接用的，不带技能，也不出现在插件市场。",
  browserUse: "让 AI 操作 MyCode 内置浏览器，检查网页并验证交互是否正常。",
  computerUse: "让 AI 驱动鼠标、键盘和界面元素，自动操作桌面应用，代你完成实际任务。",
} as const;

const OFFICIAL_PLUGIN_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  [MYCODE_NODE_REPL_HOST_PLUGIN_ID, OFFICIAL_PLUGIN_DESCRIPTIONS_ZH_CN.nodeReplHost],
  [
    `browser-use@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`,
    OFFICIAL_PLUGIN_DESCRIPTIONS_ZH_CN.browserUse,
  ],
  [
    `computer-use@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`,
    OFFICIAL_PLUGIN_DESCRIPTIONS_ZH_CN.computerUse,
  ],
]);

export function resolveOfficialPluginDescription(
  pluginId: string,
  locale: string,
): string | undefined {
  return locale.split("-")[0] === "zh" ? OFFICIAL_PLUGIN_DESCRIPTIONS.get(pluginId) : undefined;
}

const CANONICAL_PLUGIN_NAME_ACRONYMS: Readonly<Record<string, string>> = {
  aws: "AWS",
  mcp: "MCP",
  mycode: "MyCode",
};

/** listing 的多语言字段先精确匹配，再按语言前缀兜底。 */
export function resolveLocalizedText(
  locale: string,
  base: string | undefined,
  i18n: Record<string, string> | undefined,
): string | undefined {
  if (i18n) {
    const exact = i18n[locale];
    if (exact) return exact;
    const language = locale.split("-")[0];
    if (language) {
      const match = Object.entries(i18n).find(([key]) => key.split("-")[0] === language);
      if (match?.[1]) return match[1];
    }
  }
  return base;
}

export function formatCanonicalPluginName(name: string, locale: string): string {
  return name
    .trim()
    .split(/[-_]+/u)
    .filter(Boolean)
    .map(
      (part) =>
        CANONICAL_PLUGIN_NAME_ACRONYMS[part.toLowerCase()] ??
        `${part.charAt(0).toLocaleUpperCase(locale)}${part.slice(1)}`,
    )
    .join(" ");
}

/**
 * 用户可见插件名称只信任与完整 Plugin ID 关联的 listing；缺失时才回退到 canonical slug。
 * 不按裸 manifest name 猜测官方产品名，避免同名 marketplace 插件互相覆盖。
 */
export function resolvePluginDisplayName(
  plugin: { name: string; listing?: MyCodePluginStoreListing },
  locale: string,
): string {
  return (
    resolveLocalizedText(locale, plugin.listing?.displayName, plugin.listing?.displayNameI18n) ??
    formatCanonicalPluginName(plugin.name, locale)
  );
}
