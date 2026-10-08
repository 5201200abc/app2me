import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyOperationGroups(page, output) {
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = page.locator("#inventory-tool-fixture");
  await fixture.evaluate((el) => el.classList.add("conversation-reference-surface"));
  const column = fixture.locator("[data-tool-fixture-column]");
  let sequence = 0;
  const mount = async (names, options = {}) => {
    const scope = options.scope ?? `operations-${++sequence}`;
    await page.evaluate(
      ({ names, options, scope }) => {
        const { rows, png, render } = window.__inventoryFixture;
        const base = (rowId) => ({
          rowId,
          turnId: "fixture",
          createdAt: Date.now(),
          createdAtSeq: rowId,
        });
        const calls = names.map((name, index) => {
          const rowId = index * 2 + 3;
          const extra =
            name === "Read"
              ? {
                  input: { file_path: "/fixture/source.ts" },
                  output: { text: "const source = 1;" },
                }
              : name === "Edit"
                ? {
                    input: {
                      file_path: "/fixture/changed.ts",
                      old_string: "old",
                      new_string: "new",
                    },
                    output: {
                      text: "Edited",
                      display: {
                        kind: "file_diff",
                        filePath: "/fixture/changed.ts",
                        additions: 6,
                        deletions: 1,
                        structuredPatch: [
                          {
                            oldStart: 1,
                            oldLines: 1,
                            newStart: 1,
                            newLines: 1,
                            lines: ["-old", "+new"],
                          },
                        ],
                      },
                    },
                  }
                : name === "Write"
                  ? {
                      input: { file_path: "/fixture/created.ts", content: "new\n" },
                      output: { text: "Created" },
                    }
                  : name === "Bash"
                    ? {
                        input: {
                          command: "rtk rg -n very-long-pattern " + "packages/ui/src/".repeat(30),
                        },
                        output: { text: "command output\n".repeat(120) },
                      }
                    : name === "Skill"
                      ? {
                          input: { skill: "computer-use:computer-use" },
                          output: { text: "Complete skill instructions\n".repeat(100) },
                        }
                      : name === "WebSearch"
                        ? { input: { query: "界面设计" }, output: { text: "search result" } }
                        : name === "view_image" || name === "mcp__node_repl__js"
                          ? {
                              input: {},
                              display: {
                                kind: "node_repl_images",
                                images: [{ base64: png, mimeType: "image/png" }],
                                ...(name === "mcp__node_repl__js"
                                  ? { source: "browser_turn_end" }
                                  : {}),
                              },
                              output: { text: "[Attached image/png]" },
                            }
                          : {
                              input: {},
                              display: {
                                kind: "mcp_tool",
                                serverName: "cua_driver",
                                toolName: name.split("__").at(-1),
                              },
                              output: {
                                text:
                                  "✅ Found 94 app(s): 9 running, 85 installed-not-running.\n" +
                                  "raw result\n".repeat(100),
                              },
                            };
          return {
            ...base(rowId),
            kind: "toolCall",
            toolCallId: `shared-tool-${index}`,
            toolName: name,
            status:
              options.running && index === names.length - 1
                ? "running"
                : options.failure && index === names.length - 1
                  ? "error"
                  : "success",
            inputText: "",
            ...extra,
          };
        });
        const work = calls.flatMap((call, index) =>
          options.thought && index === 0
            ? [
                call,
                {
                  ...base(call.rowId + 1),
                  kind: "reasoning",
                  state: "complete",
                  text: "独立推理内容",
                },
              ]
            : [call],
        );
        window.__operationRows = [
          rows[0],
          rows[1],
          ...work,
          { ...base(100), kind: "assistantText", state: "complete", text: "正文仍然独立显示" },
        ];
        render({ scope, workRows: window.__operationRows });
      },
      { names, options, scope },
    );
    await page.waitForFunction(
      (scope) =>
        document
          .querySelector("[data-tool-fixture-column]")
          ?.getAttribute("data-fixture-session") === scope,
      scope,
    );
    if (names.length === 1 && names[0] === "mcp__node_repl__js") {
      await column.locator('[data-tool-layout-variant="image"]').waitFor();
      return scope;
    }
    const history = fixture.locator(".conversation-work-summary button");
    await history.waitFor();
    if ((await history.getAttribute("aria-expanded")) === "false") await history.click();
    await column.locator(".conversation-work-log").waitFor();
    return scope;
  };
  const header = () =>
    column.locator('[data-tool-layout-variant="operations"] > [data-slot="collapsible-trigger"]');
  const combos = [
    [["Skill", "Edit", "Read", "Bash"], "已加载工具、编辑文件、读取文件、运行命令", "wrench"],
    [
      [
        "mcp__computer-use__check_permissions",
        "mcp__computer-use__list_apps",
        "Edit",
        "Read",
        "Bash",
      ],
      "已使用 cua_driver 集成、编辑文件、读取文件、运行命令",
      "waypoints",
    ],
    [["Edit", "Read", "Bash"], "已编辑文件、读取文件、运行命令", "write"],
    [["Read", "Bash"], "已读取文件、运行命令", "book-open"],
    [["Edit", "Bash"], "已编辑文件、运行命令", "write"],
    [["Bash", "WebSearch"], "已运行命令、搜索网页", "square-terminal"],
    [["Bash", "Read", "Write", "Edit"], "正在编辑文件", "write", { running: true }],
  ];
  for (const [names, text, icon, options] of combos) {
    await mount(names, options);
    assert.equal(await header().count(), 1);
    assert.equal(await header().getAttribute("aria-expanded"), "false");
    assert.equal(await header().innerText(), text);
    assert.equal(await header().locator(`svg.lucide-${icon}`).count(), 1);
    const dimensions = await header().evaluate((el) => {
      const label = el.querySelector(".tool-summary-kind-label"),
        arrow = el.querySelector(":scope > svg:last-child");
      return {
        height: el.getBoundingClientRect().height,
        font: getComputedStyle(el).fontSize,
        icon: el.querySelector("svg").getBoundingClientRect().width,
        stroke: el.querySelector("svg").getAttribute("stroke-width"),
        arrowGap: arrow.getBoundingClientRect().x - label.getBoundingClientRect().right,
      };
    });
    assert.equal(dimensions.height, 28);
    assert.equal(dimensions.font, "13px");
    assert.equal(dimensions.icon, 14);
    assert.equal(dimensions.stroke, "1.5");
    if (icon === "write")
      assert.equal(
        await header()
          .locator(".lucide-write path")
          .first()
          .evaluate((el) => getComputedStyle(el).strokeWidth),
        "2px",
      );
    assert.ok(dimensions.arrowGap >= 0 && dimensions.arrowGap <= 8, JSON.stringify(dimensions));
    await header().press("Enter");
    const children = column.locator("[data-operation-list-item] > [data-slot=collapsible-trigger]");
    await children.first().waitFor();
    assert.equal(await children.count(), names.length);
    assert.ok(
      (
        await children.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))
      ).every((n) => n === 24),
    );
    assert.equal(await children.locator(".lucide-check").count(), 0);
    if (names.includes("WebSearch"))
      assert.equal(
        await children.nth(names.indexOf("WebSearch")).locator(".lucide-globe").count(),
        1,
      );
    const childText = await children.allTextContents();
    if (names.includes("Edit"))
      assert.match(childText[names.indexOf("Edit")], /changed.ts.*\+6.*-1/s);
    if (names.includes("Write")) assert.match(childText[names.indexOf("Write")], /创建|写入/);
    const scroll = column.locator(
      '[data-tool-layout-variant="operations"] > [data-slot=collapsible-content] > div > .tool-detail-scroll',
    );
    assert.ok((await scroll.boundingBox()).height <= 220);
    assert.equal(
      await scroll.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll("#inventory-tool-fixture [data-slot=collapsible-content]"),
      ].every((el) =>
        el
          .getAnimations({ subtree: true })
          .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
      ),
    );
    await page.screenshot({ path: join(output, `operations-${icon}-${sequence}.png`) });
  }
  await mount(
    ["mcp__computer-use__check_permissions", "mcp__cua__list_apps", "Skill", "Read", "Bash"],
    { thought: true },
  );
  assert.equal(await column.getByTestId("chat-reasoning-trigger").count(), 0);
  await header().click();
  await column.getByTestId("chat-reasoning-trigger").waitFor();
  const app = column
    .locator("[data-operation-list-item]")
    .filter({ hasText: "列出应用 · 94 个（9 个运行中）" })
    .first();
  await app.getByRole("button", { name: "展开工具详情", exact: true }).first().click();
  await app.getByTestId("mcp-expanded-content").waitFor();
  const group = column.locator('[data-tool-layout-variant="operations"]');
  const scroll = group.locator(
    ":scope > [data-slot=collapsible-content] > div > .tool-detail-scroll",
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '[data-tool-layout-variant="operations"] > [data-slot=collapsible-content]',
      ),
    ].every((el) =>
      el
        .getAnimations({ subtree: true })
        .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    ),
  );
  assert.ok((await scroll.boundingBox()).height <= 220);
  const nested = await scroll.evaluate(
    (el) =>
      [...el.querySelectorAll("*")].filter(
        (n) =>
          ["auto", "scroll"].includes(getComputedStyle(n).overflowY) &&
          n.scrollHeight > n.clientHeight + 1,
      ).length,
  );
  assert.equal(nested, 0);
  assert.equal(
    await app
      .locator("pre")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "12px",
  );
  const skill = column
    .locator("[data-operation-list-item]")
    .filter({ hasText: "computer-use" })
    .last();
  await skill.getByRole("button", { name: "展开工具详情", exact: true }).first().click();
  await skill.locator("pre").waitFor();
  assert.match(await skill.locator("pre").innerText(), /Complete skill instructions/);
  await column.getByRole("button", { name: "source.ts", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__inventoryFixture.counters.preview), 1);
  await mount(["Read", "Bash"], { scope: "stream" });
  await header().click();
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    const r = window.__operationRows;
    f.render({
      workRows: [
        ...r.slice(0, -1),
        { ...r[2], rowId: 90, toolCallId: "stream-added", toolName: "Edit" },
        r.at(-1),
      ],
    });
  });
  assert.equal(await header().getAttribute("aria-expanded"), "true");
  await mount(["Read", "Bash"], { scope: "other-session" });
  assert.equal(await header().getAttribute("aria-expanded"), "false");
  await mount(["Bash", "Edit"], { failure: true });
  await header().click();
  assert.equal(await column.locator("[data-operation-list-item] .lucide-x").count(), 1);
  for (const name of ["view_image", "mcp__node_repl__js"]) {
    await mount([name]);
    const imageRow = column.locator('[data-tool-layout-variant="image"]');
    const trigger = imageRow.getByRole("button", { name: "展开工具详情", exact: true });
    await trigger.waitFor();
    assert.match(await trigger.innerText(), /已查看图片/);
    assert.equal(await trigger.locator(".lucide-images").count(), 1);
    assert.equal(await imageRow.locator("img").count(), 0);
    await trigger.click();
    const thumbnail = imageRow.locator("[data-image-thumbnail-trigger]");
    await thumbnail.waitFor();
    assert.equal((await thumbnail.boundingBox()).width, 80);
    assert.equal((await thumbnail.boundingBox()).height, 80);
    await thumbnail.click();
    await page.getByTestId("node-repl-image-lightbox").waitFor();
    await page.keyboard.press("Escape");
  }
  await mount(["Skill", "Edit", "Read", "Bash"]);
  for (const theme of ["mycode-light", "mycode-dark"]) {
    await page.evaluate((theme) => window.__inventoryFixture.applyTheme(theme), theme);
    for (const width of [1440, 700, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok((await column.boundingBox()).width <= 760);
      assert.equal(await header().evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    }
  }
  await page.evaluate(() => {
    window.__inventoryFixture.root.unmount();
    window.__inventoryFixture.host.remove();
    navigator.clipboard.writeText = window.__inventoryFixture.originalClipboardWrite;
  });
}
