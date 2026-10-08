import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

export async function verifyWriteIconPolish(page, output) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationRowView } = await f.load("v4/ConversationRowView.tsx");
    const { WriteIcon } = await f.load("components/ui/write-icon.tsx");
    const { ChatEmptyWorkspacePreviewMenu } = await f.load("ChatEmptyState.tsx");
    const { useMyCodeIntl } = await f.load("i18n/IntlProvider.tsx");
    const context = {
      workspacePath: "/fixture",
      sessionId: "write-polish",
      logEpoch: "1",
      theme: "mycode-dark",
      onOpenCodeViewer() {},
    };
    const calls = [
      { name: "Write", path: "write.ts", status: "success", added: 453, removed: 0 },
      { name: "Write", path: "failed.ts", status: "error", added: 413, removed: 0 },
      { name: "Edit", path: "edit.ts", status: "success", added: 0, removed: 3 },
      { name: "Edit", path: "failed-edit.ts", status: "error", added: 1, removed: 1 },
      { name: "Read", path: "read.ts", status: "success" },
    ].map((call, index) => ({
      rowId: 30 + index,
      turnId: "fixture",
      createdAt: Date.now(),
      createdAtSeq: 30 + index,
      kind: "toolCall",
      toolCallId: `write-polish-${index}`,
      toolName: call.name,
      status: call.status,
      inputText: "",
      input: {
        file_path: `/fixture/${call.path}`,
        ...(call.name === "Write"
          ? { content: "new\n" }
          : call.name === "Edit"
            ? { old_string: "old", new_string: "new" }
            : {}),
      },
      output: {
        text: call.status === "error" ? "Permission denied" : "Completed",
        ...(call.added !== undefined
          ? {
              display: {
                kind: "file_diff",
                filePath: `/fixture/${call.path}`,
                additions: call.added,
                deletions: call.removed,
                structuredPatch: [
                  { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
                ],
              },
            }
          : {}),
      },
    }));
    const semanticCalls = [
      { toolName: "GoalRead", icon: "target-arrow", input: {}, output: { text: "目标" } },
      {
        toolName: "mcp__computer_use__left_click",
        icon: "pointer-2",
        input: { title: "点击", x: 1, y: 1 },
        output: { text: "已点击" },
      },
      {
        toolName: "mcp__fixture__list",
        icon: "layout-dashboard",
        input: {},
        display: { kind: "mcp_tool", serverName: "fixture", toolName: "list" },
        output: { text: "列出项目" },
      },
    ].map((call, index) => ({
      ...calls[4],
      ...call,
      rowId: 70 + index,
      toolCallId: "semantic-" + index,
    }));
    function ProxyCopy() {
      const { intl } = useMyCodeIntl();
      return f.h("input", {
        "data-proxy-copy": "",
        placeholder: intl.formatMessage({ id: "settings.httpProxyPlaceholder" }),
      });
    }
    const workRows = [
      f.rows[0],
      f.rows[1],
      ...calls,
      { ...f.rows[9], rowId: 40, text: "写入验证" },
    ];
    f.host.classList.add("conversation-reference-surface");
    f.render({
      workRows,
      context,
      platform: { onRemoteConnectionLog: () => () => {} },
      extra: f.h(
        "div",
        { "data-write-polish": "" },
        ...calls.map((row) =>
          f.h(
            "div",
            { key: row.rowId, "data-standalone-tool": row.toolName },
            f.h(ConversationRowView, {
              row: { ...row, toolCallId: `${row.toolCallId}-standalone` },
              context,
            }),
          ),
        ),
        f.h(
          "div",
          { "data-pen-gallery": "" },
          ...[12, 14, 16, 20].map((size) => f.h(WriteIcon, { key: size, size })),
        ),
        ...semanticCalls.map((row) =>
          f.h(
            "div",
            { key: row.rowId, "data-tabler-semantic": row.icon },
            f.h(ConversationRowView, { row, context }),
          ),
        ),
        f.h(ProxyCopy),
        f.h(ChatEmptyWorkspacePreviewMenu, {
          workspacePath: "/fixture/default",
          workspaceTabs: [],
          remoteConnectionPlacement: "inline",
          onSelectWorkspace() {},
          onSelectConversationWorkspace() {},
          onOpenFolder() {},
          onConnectRemote: async () => "fixture",
          onSelectRemoteProject: async () => {},
          onCancelRemoteProject: async () => {},
        }),
      ),
    });
  });
  const fixture = page.locator("#inventory-tool-fixture");
  const standalone = fixture.locator("[data-standalone-tool]");
  await standalone.first().waitFor();
  for (const index of [0, 1, 2, 3]) {
    const row = standalone.nth(index);
    assert.equal(await row.locator("svg[data-write-icon]").count(), 1);
    assert.equal(await row.locator("svg.tabler-icon-check, svg.tabler-icon-x").count(), 0);
    const icon = row.locator("svg[data-write-icon]");
    assert.equal(await icon.evaluate((el) => getComputedStyle(el).strokeWidth), "2px");
    assert.equal((await icon.boundingBox()).width, 14);
  }
  for (const [index, added, removed] of [
    [0, 453, 0],
    [1, 413, 0],
    [2, 0, 3],
    [3, 1, 1],
  ]) {
    const stats = standalone.nth(index).locator("[data-tool-diff-count]");
    await stats.waitFor();
    assert.equal(await stats.locator(`[aria-label='+${added}']`).count(), 1);
    assert.equal(await stats.locator(`[aria-label='-${removed}']`).count(), 1);
  }
  for (const [index, iconName] of [
    [0, "edit"],
    [1, "pencil-off"],
    [2, "edit"],
    [3, "pencil-off"],
    [4, "book"],
  ]) {
    assert.equal(await standalone.nth(index).locator(`svg.tabler-icon-${iconName}`).count(), 1);
    assert.ok(!(await standalone.nth(index).innerText()).includes("执行失败"));
  }
  for (const iconName of ["target-arrow", "pointer-2", "layout-dashboard"]) {
    const icon = fixture.locator(
      `[data-tabler-semantic="${iconName}"] svg.tabler-icon-${iconName}`,
    );
    await icon.waitFor();
    assert.equal((await icon.boundingBox()).width, 14);
    assert.equal(await icon.evaluate((el) => getComputedStyle(el).strokeWidth), "2px");
  }
  const geometry = await standalone.evaluateAll((rows) =>
    rows.map((row) => {
      const filename = row.querySelector("button[title] > span.truncate");
      const font = getComputedStyle(filename);
      const stats = row.querySelector("[data-tool-diff-count]");
      return {
        font: font.fontSize,
        color: font.color,
        weight: font.fontWeight,
        ...(stats
          ? {
              statFont: getComputedStyle(stats).fontSize,
              statColor: getComputedStyle(stats).color,
              centerGap: Math.abs(
                stats.getBoundingClientRect().y +
                  stats.getBoundingClientRect().height / 2 -
                  filename.getBoundingClientRect().y -
                  filename.getBoundingClientRect().height / 2,
              ),
            }
          : {}),
      };
    }),
  );
  for (const value of geometry) {
    assert.equal(value.font, geometry[4].font);
    assert.equal(value.color, geometry[4].color);
    assert.equal(value.weight, "400");
    if (value.statFont) {
      assert.equal(value.statFont, "10px");
      assert.equal(value.statColor, value.color);
      assert.ok(value.centerGap <= 1);
    }
  }
  assert.equal(
    await fixture.locator("[data-proxy-copy]").getAttribute("placeholder"),
    "没有填写默认内置浏览器跟随系统代理，e.g http://127.0.0.1:7890",
  );
  const remote = fixture.getByTestId("composer-remote-connection");
  await remote.waitFor();
  assert.equal(await remote.locator("svg.tabler-icon-cloud").count(), 1);
  await fixture.getByRole("button", { name: /已工作/ }).click();
  const group = fixture.locator(
    '[data-tool-layout-variant="operations"] > [data-slot="collapsible-trigger"]',
  );
  await group.waitFor();
  assert.equal(await group.locator("svg[data-write-icon]").count(), 1);
  await group.click();
  const children = fixture.locator("[data-operation-list-item]");
  await children.first().waitFor();
  assert.equal(await children.count(), 5);
  assert.equal(await children.locator("svg[data-write-icon]").count(), 4);
  assert.equal(await children.locator("svg.tabler-icon-x, svg.tabler-icon-check").count(), 0);
  assert.equal(await children.nth(1).locator("svg.tabler-icon-pencil-off").count(), 1);
  const failedLink = children.nth(1).locator(".tool-summary-content button").first();
  assert.equal(
    await failedLink.evaluate((el) => getComputedStyle(el).textDecorationStyle),
    "solid",
  );
  await children.nth(1).locator(":scope > [data-slot=collapsible-trigger]").click();
  await children.nth(1).getByText("Permission denied").first().waitFor();
  const sizes = await fixture
    .locator("[data-pen-gallery] svg")
    .evaluateAll((els) =>
      els.map((el) => [el.getBoundingClientRect().width, getComputedStyle(el).strokeWidth]),
    );
  assert.deepEqual(sizes, [
    [12, "2px"],
    [14, "2px"],
    [16, "2px"],
    [20, "2px"],
  ]);
  await fixture.locator("[data-slot='collapsible-content']").evaluateAll(async (els) => {
    await Promise.all(
      els.flatMap((el) => el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
  });
  await page.screenshot({ path: join(output, "write-icon-polish.png") });
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
  });
}
