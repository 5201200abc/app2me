import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IconEdit,
  IconPencilOff,
  IconBook,
  IconTargetArrow,
  IconPointer2,
  IconLayoutDashboard,
  IconHelp,
  IconSettings,
  type TablerIcon,
} from "@tabler/icons-react";
import {
  BookOpen,
  GoalIcon,
  MousePointerClick,
  Waypoints,
  Help,
  Settings,
  IconProvider,
  type UiIcon,
} from "../src/components/icons/tabler.js";
import { WriteIcon } from "../src/components/ui/write-icon.js";
import { ClientSceneLucideIcon } from "../src/components/ClientSceneLucideIcon.js";
import { ToolPresentationStatusContext } from "../src/ToolCallBlocks/ToolPresentationContext.js";
import { GOAL_COMMAND_MENTION_ICON_NODE } from "../src/mentions/nodes/mentionIconDom.js";

function shapes(html: string): string[] {
  return html.match(/<(?:path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/gu) ?? [];
}

test("六种操作图标保留 Tabler 官方 SVG 路径", () => {
  const pairs: [UiIcon, TablerIcon][] = [
    [BookOpen, IconBook],
    [GoalIcon, IconTargetArrow],
    [MousePointerClick, IconPointer2],
    [Waypoints, IconLayoutDashboard],
    [Help, IconHelp],
    [Settings, IconSettings],
  ];
  for (const [actual, official] of pairs) {
    assert.deepEqual(
      shapes(renderToStaticMarkup(createElement(actual))),
      shapes(renderToStaticMarkup(createElement(official))),
    );
  }
  for (const [failed, official] of [
    [false, IconEdit],
    [true, IconPencilOff],
  ] as const) {
    const html = renderToStaticMarkup(createElement(WriteIcon, { failed, size: 14 }));
    assert.deepEqual(shapes(html), shapes(renderToStaticMarkup(createElement(official))));
    assert.ok(html.includes('width="14"') && html.includes('height="14"'));
  }
});

test("失败投影切换 pencil-off，显式非失败状态仍使用 edit", () => {
  const inherited = renderToStaticMarkup(
    createElement(
      ToolPresentationStatusContext.Provider,
      { value: "failed" },
      createElement(WriteIcon),
    ),
  );
  const explicit = renderToStaticMarkup(
    createElement(
      ToolPresentationStatusContext.Provider,
      { value: "failed" },
      createElement(WriteIcon, { failed: false }),
    ),
  );
  assert.deepEqual(shapes(inherited), shapes(renderToStaticMarkup(createElement(IconPencilOff))));
  assert.deepEqual(shapes(explicit), shapes(renderToStaticMarkup(createElement(IconEdit))));
});

test("根层线宽默认值和局部覆盖不改变路径或图标大小", () => {
  const html = renderToStaticMarkup(
    createElement(
      IconProvider,
      { strokeWidth: 1.5 },
      createElement(BookOpen, { size: 16, strokeWidth: 2 }),
    ),
  );
  assert.ok(html.includes('stroke-width="2"'));
  assert.ok(html.includes('width="16"') && html.includes('height="16"'));
});

test("旧场景语义名和 Tabler 名使用同一图形，未知名保留原有回退", () => {
  for (const name of ["book-open", "book"]) {
    const html = renderToStaticMarkup(
      createElement(ClientSceneLucideIcon, { name, fallback: "fallback" }),
    );
    assert.deepEqual(shapes(html), shapes(renderToStaticMarkup(createElement(IconBook))));
  }
  assert.equal(
    renderToStaticMarkup(
      createElement(ClientSceneLucideIcon, { name: "unknown-scene", fallback: "fallback" }),
    ),
    "fallback",
  );
});

test("输入中的目标命令和工具行使用同一 target-arrow 路径", () => {
  const actual = GOAL_COMMAND_MENTION_ICON_NODE.map(([, attrs]) => attrs.d).filter(Boolean);
  const official = shapes(renderToStaticMarkup(createElement(IconTargetArrow)))
    .map((node) => node.match(/\bd="([^"]+)"/u)?.[1])
    .filter(Boolean);
  assert.deepEqual(actual, official);
});
