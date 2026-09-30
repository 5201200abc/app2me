export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "mycode-plugins-official";
export const MYCODE_NODE_REPL_HOST_PLUGIN_ID = `node-repl-host@${MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`;

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@mycode-plugins-official",
  "image-search@mycode-plugins-official",
  "documents@mycode-plugins-official",
  "pdf@mycode-plugins-official",
  "presentations@mycode-plugins-official",
  "spreadsheets@mycode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@mycode-plugins-official",
  "skill-creator@mycode-plugins-official",
  "plugin-creator@mycode-plugins-official",
  "mycode-guide@mycode-plugins-official",
  // 电脑控制回退为默认关闭，故 computer-use 不在此名单内。
  // 该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，
  // bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者。
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // MyCode 官方市场只读取随应用打包的插件，不再连接远端目录。
    id: MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "bundled",
    name: MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official MyCode plugins marketplace: built-in and community plugins for MyCode.",
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个 MyCode 官方市场 id。
export const PUBLIC_STORE_MARKETPLACE_IDS = [MYCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
