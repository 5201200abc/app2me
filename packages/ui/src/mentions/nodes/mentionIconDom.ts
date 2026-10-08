// Lexical 节点使用原生 SVG DOM；图形数据取自 @tabler/icons-react 3.48.0（MIT）。
// 保持官方路径，避免输入中的目标/技能图标与工具行使用不同轮廓。
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type MentionIconNode = ReadonlyArray<
  readonly ["path" | "circle" | "rect", Readonly<Record<string, string>>]
>;
// https://tabler.io/icons/icon/wand
export const SKILL_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M6 21l15 -15l-3 -3l-15 15l3 3",
    },
  ],
  [
    "path",
    {
      d: "M15 6l3 3",
    },
  ],
  [
    "path",
    {
      d: "M9 3a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2",
    },
  ],
  [
    "path",
    {
      d: "M19 13a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/robot
export const SUBAGENT_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4",
    },
  ],
  [
    "path",
    {
      d: "M12 2v2",
    },
  ],
  [
    "path",
    {
      d: "M9 12v9",
    },
  ],
  [
    "path",
    {
      d: "M15 12v9",
    },
  ],
  [
    "path",
    {
      d: "M5 16l4 -2",
    },
  ],
  [
    "path",
    {
      d: "M15 14l4 2",
    },
  ],
  [
    "path",
    {
      d: "M9 18h6",
    },
  ],
  [
    "path",
    {
      d: "M10 8v.01",
    },
  ],
  [
    "path",
    {
      d: "M14 8v.01",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/palette
export const WHITEBOARD_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25",
    },
  ],
  [
    "path",
    {
      d: "M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    },
  ],
  [
    "path",
    {
      d: "M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    },
  ],
  [
    "path",
    {
      d: "M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/target-arrow
export const GOAL_COMMAND_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    },
  ],
  [
    "path",
    {
      d: "M12 7a5 5 0 1 0 5 5",
    },
  ],
  [
    "path",
    {
      d: "M13 3.055a9 9 0 1 0 7.941 7.945",
    },
  ],
  [
    "path",
    {
      d: "M15 6v3h3l3 -3h-3v-3l-3 3",
    },
  ],
  [
    "path",
    {
      d: "M15 9l-3 3",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/schema
export const WORKFLOW_COMMAND_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M5 2h5v4h-5l0 -4",
    },
  ],
  [
    "path",
    {
      d: "M15 10h5v4h-5l0 -4",
    },
  ],
  [
    "path",
    {
      d: "M5 18h5v4h-5l0 -4",
    },
  ],
  [
    "path",
    {
      d: "M5 10h5v4h-5l0 -4",
    },
  ],
  [
    "path",
    {
      d: "M10 12h5",
    },
  ],
  [
    "path",
    {
      d: "M7.5 6v4",
    },
  ],
  [
    "path",
    {
      d: "M7.5 14v4",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/script
export const COMPACT_COMMAND_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M17 20h-11a3 3 0 0 1 0 -6h11a3 3 0 0 0 0 6h1a3 3 0 0 0 3 -3v-11a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v8",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/square-asterisk
export const COMMAND_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14",
    },
  ],
  [
    "path",
    {
      d: "M12 8.5v7",
    },
  ],
  [
    "path",
    {
      d: "M9 10l6 4",
    },
  ],
  [
    "path",
    {
      d: "M9 14l6 -4",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/messages
export const SESSION_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10",
    },
  ],
  [
    "path",
    {
      d: "M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2",
    },
  ],
] as const satisfies MentionIconNode;
// https://tabler.io/icons/icon/plug-connected
export const PLUGIN_MENTION_ICON_NODE = [
  [
    "path",
    {
      d: "M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5",
    },
  ],
  [
    "path",
    {
      d: "M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5",
    },
  ],
  [
    "path",
    {
      d: "M3 21l2.5 -2.5",
    },
  ],
  [
    "path",
    {
      d: "M18.5 5.5l2.5 -2.5",
    },
  ],
  [
    "path",
    {
      d: "M10 11l-2 2",
    },
  ],
  [
    "path",
    {
      d: "M13 14l-2 2",
    },
  ],
] as const satisfies MentionIconNode;

export function createMentionSvgIcon(iconNode: MentionIconNode): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("inline-block", "align-middle", "shrink-0");

  for (const [tagName, attributes] of iconNode) {
    const node = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }

  return svg;
}
