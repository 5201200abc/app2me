import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";
import { verifyTaskRowRefinement } from "./mycode-sidebar-refinement.mjs";

export async function verifyConversationUiPolish(page, output) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { WorkspaceSidebarFooter } = await f.load("WorkspaceSidebarFooter.tsx");
    const { ConversationRowView } = await f.load("v4/ConversationRowView.tsx");
    const { useMyCodeIntl } = await f.load("i18n/IntlProvider.tsx");
    const workRows = [
      f.rows[0],
      f.rows[1],
      { ...f.rows[2], text: "核对气象资料" },
      { ...f.rows[4], rowId: 4, text: "我来查一下北京今天的天气" },
      { ...f.rows[5], rowId: 5 },
      { ...f.rows[2], rowId: 6, text: "整理预报结果" },
      { ...f.rows[9], rowId: 7, text: "今天北京不下雨。" },
    ];
    function Labels() {
      const { intl } = useMyCodeIntl();
      return f.h(
        "div",
        { "data-polish-labels": "" },
        [
          "chat.contextUsage.title",
          "settings.computerUse.title",
          "settings.sidebar.group.dataAndStats",
        ].map((id) => f.h("span", { key: id }, intl.formatMessage({ id }))),
      );
    }
    f.host.classList.add("conversation-reference-surface");
    f.render({
      workRows,
      extra: f.h(
        "div",
        null,
        f.h(Labels),
        f.h(
          "div",
          { "data-polish-model-switch": "" },
          f.h(ConversationRowView, {
            row: {
              rowId: 20,
              turnId: "fixture",
              createdAt: Date.now(),
              createdAtSeq: 20,
              kind: "timelineMarker",
              marker: {
                type: "modelChange",
                fromProvider: "deepseek",
                fromModel: "deepseek-flash",
                toProvider: "llama",
                toModel: "org/Qwen3.8-27B",
              },
            },
            context: { workspacePath: "/fixture/default", theme: "mycode-dark" },
          }),
        ),
        f.h(
          "div",
          { "data-polish-footer": "", style: { width: 260 } },
          f.h(WorkspaceSidebarFooter, {
            workspacePath: "/fixture/default",
            theme: "mycode-dark",
            localeMenuValue: "zh-CN",
            isDesktop: true,
            onLocaleChange() {},
            onThemeChange() {},
          }),
        ),
      ),
    });
  });
  const fixture = page.locator("#inventory-tool-fixture");
  await fixture.getByText("今天北京不下雨。", { exact: true }).waitFor();
  await fixture.getByRole("button", { name: /已工作/ }).click();
  await fixture.locator('[data-row-id="3"]').waitFor();
  await fixture.locator('[data-history-open="true"]').evaluateAll(async (els) => {
    await Promise.all(
      els.flatMap((el) => el.getAnimations().map((animation) => animation.finished)),
    );
  });
  const spacing = await fixture.evaluate((el) => {
    const box = (id) => el.querySelector(`[data-row-id="${id}"]`).getBoundingClientRect();
    return { first: box(4).top - box(3).bottom, final: box(7).top - box(6).bottom };
  });
  assert.deepEqual(spacing, { first: 8, final: 8 });
  const changed = fixture.locator("[data-inventory-change] svg");
  assert.equal((await changed.boundingBox()).width, 16);
  const geometry = await changed.evaluate((el) => {
    const icon = el.getBoundingClientRect(),
      row = el.closest("button").getBoundingClientRect();
    return Math.abs(icon.y + icon.height / 2 - row.y - row.height / 2);
  });
  assert.equal(geometry, 0);
  await fixture.getByText("deepseek-flash 模型已切换 org/Qwen3.8-27B", { exact: true }).waitFor();
  const labels = fixture.locator("[data-polish-labels]");
  assert.equal(await labels.textContent(), "上下文窗口计算机使用Cost");
  const footer = fixture.locator("[data-polish-footer]");
  await footer.getByRole("button", { name: "设置", exact: true }).waitFor();
  const sizes = await footer.evaluate((el) =>
    [...el.querySelectorAll("svg")].slice(-3).map((svg) => {
      const box = svg.getBoundingClientRect();
      return [box.width, box.height];
    }),
  );
  assert.deepEqual(sizes, [
    [16, 16],
    [16, 16],
    [16, 16],
  ]);
  await page.screenshot({ path: join(output, "conversation-ui-polish.png") });
  await verifyTaskRowRefinement(page, output, true);
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
  });
}
