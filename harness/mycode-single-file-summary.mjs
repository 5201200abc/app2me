import assert from "node:assert/strict";
import { join } from "node:path";
import { mountInventoryToolFixture } from "./mycode-inventory-tool-fixture.mjs";

function contrast(a, b) {
  const luminance = (rgb) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export async function verifySingleFileSummaries(page, output) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(mountInventoryToolFixture, process.cwd());
  await page.evaluate(async () => {
    const f = window.__inventoryFixture;
    const { ConversationRowView } = await f.load("v4/ConversationRowView.tsx");
    const { MyCodeIntlProvider } = await f.load("i18n/IntlProvider.tsx");
    const rows = [
      {
        rowId: 301,
        toolName: "Write",
        input: {
          file_path: "/fixture/main.go",
          content: Array.from({ length: 249 }, (_, i) => `new line ${i}`).join("\n"),
        },
      },
      {
        rowId: 302,
        toolName: "Edit",
        input: {
          file_path: "/fixture/release.yaml",
          old_string: "old 1\nold 2\nold 3",
          new_string: "new 1\nnew 2\nnew 3\nnew 4\nnew 5",
        },
      },
      {
        rowId: 303,
        toolName: "Edit",
        input: {
          file_path: `/fixture/${"long-filename-".repeat(20)}.yaml`,
          old_string: "before",
          new_string: "after",
        },
      },
      {
        rowId: 304,
        toolName: "Edit",
        input: {},
        output: {
          display: {
            kind: "file_diffs",
            files: ["one.ts", "two.ts"].map((name) => ({
              kind: "file_diff",
              filePath: `/fixture/${name}`,
              additions: 1,
              deletions: 1,
              structuredPatch: [
                {
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: ["-before", "+after"],
                },
              ],
            })),
          },
        },
      },
    ].map((row) => ({
      ...row,
      kind: "toolCall",
      turnId: "files",
      createdAt: Date.now(),
      createdAtSeq: row.rowId,
      toolCallId: `file-${row.rowId}`,
      status: "success",
      inputText: "",
      output: row.output ?? { text: "Original file operation output." },
    }));
    const context = {
      workspacePath: "/fixture",
      sessionId: "file-summary",
      logEpoch: "1",
      onOpenCodeViewer() {
        f.counters.preview++;
      },
    };
    window.__fileFixture = {
      rows,
      counters: f.counters,
      applyTheme: f.applyTheme,
      render(locale = "en-US") {
        f.render({
          empty: true,
          workRows: [{ ...f.rows[0], fileChanges: undefined }, f.rows[9]],
          extra: f.h(
            MyCodeIntlProvider,
            { initialLocale: locale, key: locale },
            f.h(
              "section",
              { "data-file-fixture": "", className: "mx-auto w-full max-w-[760px] space-y-1 p-4" },
              ...rows.map((row) => f.h(ConversationRowView, { key: row.rowId, row, context })),
            ),
          ),
        });
      },
    };
    window.__fileFixture.render();
  });
  const fixture = page.locator("[data-file-fixture]");
  for (const locale of ["en-US", "zh-CN"]) {
    await page.evaluate((locale) => window.__fileFixture.render(locale), locale);
    const created = fixture.locator('[data-row-id="301"] [data-tool-file-sentence]');
    const edited = fixture.locator('[data-row-id="302"] [data-tool-file-sentence]');
    await created.waitFor();
    assert.equal(
      await created.locator("[data-file-verb]").innerText(),
      locale === "en-US" ? "Created" : "已创建",
    );
    assert.equal(
      await edited.locator("[data-file-verb]").innerText(),
      locale === "en-US" ? "Edited" : "已编辑",
    );
    assert.equal(await created.locator('[aria-label="+249"]').count(), 1);
    assert.equal(await created.locator('[aria-label="-0"]').count(), 1);
    assert.equal(await edited.locator('[aria-label="+5"]').count(), 1);
    assert.equal(await edited.locator('[aria-label="-3"]').count(), 1);
    assert.equal((await created.locator("svg.tabler-icon-pencil").boundingBox()).width, 16);
    assert.equal((await created.locator("svg.tabler-icon-chevron-right").boundingBox()).width, 14);
    assert.equal(await created.locator("svg.tabler-icon-edit").count(), 0);
    assert.equal(await created.locator("img").count(), 0);
    assert.equal(await created.locator("[data-file-activity]").count(), 0);
    const grouped = fixture.locator('[data-row-id="304"]');
    assert.equal(await grouped.locator("[data-tool-file-sentence]").count(), 0);
    const groupTrigger = grouped.locator('[data-testid="tool-summary-trigger-file-304"]');
    assert.equal(await groupTrigger.locator("svg.tabler-icon-edit").count(), 1);
    await groupTrigger.press("Enter");
    await grouped.locator("[data-tool-file-sentence]").first().waitFor();
    assert.equal(await grouped.locator("[data-tool-file-sentence]").count(), 2);
    await groupTrigger.press("Space");
    for (const theme of ["mycode-dark", "mycode-light"]) {
      await page.evaluate((theme) => window.__fileFixture.applyTheme(theme), theme);
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(180);
      const styles = await created.evaluate((el) => {
        const style = (selector) => {
          const c = getComputedStyle(el.querySelector(selector));
          return {
            font: c.fontFamily,
            size: c.fontSize,
            weight: c.fontWeight,
            color: c.color,
            decoration: c.textDecorationStyle,
            thickness: c.textDecorationThickness,
            offset: c.textUnderlineOffset,
            shrink: c.flexShrink,
          };
        };
        return {
          verb: style("[data-file-verb]"),
          file: style("[data-file-name]"),
          plus: style('[aria-label="+249"]'),
          minus: style('[aria-label="-0"]'),
          chevron: getComputedStyle(el.querySelector("svg.tabler-icon-chevron-right")).opacity,
        };
      });
      for (const node of [styles.file, styles.plus, styles.minus]) {
        assert.equal(node.font, styles.verb.font);
        assert.equal(
          node.size,
          node === styles.file
            ? styles.verb.size
            : `${Math.max(11, parseFloat(styles.verb.size) - 2)}px`,
        );
        assert.equal(node.weight, "400");
        assert.equal(node.color, node === styles.file ? styles.verb.color : styles.plus.color);
      }
      assert.equal(styles.file.decoration, "dotted");
      assert.equal(styles.file.thickness, "1px");
      assert.equal(styles.file.offset, "3px");
      assert.equal(styles.chevron, "1");
      await created.hover();
      await page.waitForTimeout(180);
      const active = await created.evaluate((el) => {
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        const rgb = (color) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const cs = getComputedStyle(el);
        return {
          verb: getComputedStyle(el.querySelector("[data-file-verb]")).color,
          file: getComputedStyle(el.querySelector("[data-file-name]")).color,
          plus: rgb(getComputedStyle(el.querySelector('[aria-label="+249"]')).color),
          minus: rgb(getComputedStyle(el.querySelector('[aria-label="-0"]')).color),
          bg: rgb(cs.getPropertyValue("--color-background")),
          chevron: getComputedStyle(el.querySelector("svg.tabler-icon-chevron-right")).opacity,
          duration: getComputedStyle(el.querySelector("[data-file-verb]")).transitionDuration,
        };
      });
      assert.equal(active.verb, active.file);
      assert.notEqual(active.file, styles.file.color);
      assert.equal(active.chevron, "1");
      assert.equal(active.duration, "0.15s");
      assert.ok(active.plus[1] > active.plus[0]);
      assert.ok(active.minus[0] > active.minus[1]);
      assert.ok(
        contrast(active.plus, active.bg) >= 4.5,
        `green contrast ${theme}: ${contrast(active.plus, active.bg)}`,
      );
      assert.ok(
        contrast(active.minus, active.bg) >= 4.5,
        `red contrast ${theme}: ${contrast(active.minus, active.bg)}`,
      );
      await page.mouse.move(0, 0);
      await created.focus();
      await page.waitForTimeout(180);
      assert.equal(
        await created
          .locator("svg.tabler-icon-chevron-right")
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      await created.press("Enter");
      assert.equal(await created.getAttribute("aria-expanded"), "true");
      await created.press("Space");
      assert.equal(await created.getAttribute("aria-expanded"), "false");
      await fixture
        .locator('[data-row-id="301"] .tool-call-layout > [data-slot="collapsible-content"]')
        .waitFor({ state: "hidden" });
      await created.locator("button").click();
      assert.equal(
        await page.evaluate(() => window.__fileFixture.counters.preview),
        locale === "en-US" ? (theme === "mycode-dark" ? 1 : 2) : theme === "mycode-dark" ? 3 : 4,
      );
      assert.equal(await created.getAttribute("aria-expanded"), "false");
      const rowSpacing = await fixture.evaluate((el) =>
        [301, 302, 303].map((id) => {
          const box = el
            .querySelector(`[data-row-id="${id}"] [data-tool-file-sentence]`)
            .getBoundingClientRect();
          return { y: box.y, height: box.height };
        }),
      );
      assert.equal(rowSpacing[0].height, rowSpacing[1].height);
      assert.equal(rowSpacing[1].height, rowSpacing[2].height);
      assert.ok(
        Math.abs(rowSpacing[1].y - rowSpacing[0].y - (rowSpacing[2].y - rowSpacing[1].y)) < 1,
      );
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const long = fixture.locator('[data-row-id="303"] [data-tool-file-sentence]');
        const layout = await long.evaluate((el) => {
          const name = el.querySelector("[data-file-name]");
          return {
            overflow: el.scrollWidth > el.clientWidth + 1,
            clipped: name.scrollWidth > name.clientWidth,
            ellipsis: getComputedStyle(name).textOverflow,
            wrap: getComputedStyle(name).whiteSpace,
            verb: getComputedStyle(el.querySelector("[data-file-verb]")).flexShrink,
            stats: getComputedStyle(el.querySelector("[data-tool-diff-count]")).flexShrink,
          };
        });
        assert.equal(layout.overflow, false);
        assert.equal(layout.clipped, true);
        assert.equal(layout.ellipsis, "ellipsis");
        assert.equal(layout.wrap, "nowrap");
        assert.equal(layout.verb, "0");
        assert.equal(layout.stats, "0");
        await page.screenshot({ path: join(output, `files-${locale}-${theme}-${width}.png`) });
      }
      await page.setViewportSize({ width: 1100, height: 800 });
    }
  }
  await page.evaluate(() => {
    window.__fileFixture.rows[0] = { ...window.__fileFixture.rows[0], status: "running" };
    window.__fileFixture.render("en-US");
  });
  const activity = fixture.locator('[data-row-id="301"] [data-file-activity]');
  await activity.waitFor();
  assert.equal((await activity.boundingBox()).width, 6);
  assert.equal((await activity.boundingBox()).height, 6);
  await page.evaluate(() => {
    window.__fileFixture.rows[0] = { ...window.__fileFixture.rows[0], status: "success" };
    window.__fileFixture.render("en-US");
  });
  await activity.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.__fileFixture.rows[0].input.content.split("\n").length),
    249,
  );
  await page.evaluate(() => {
    const f = window.__inventoryFixture;
    f.root.unmount();
    f.host.remove();
    navigator.clipboard.writeText = f.originalClipboardWrite;
  });
  return {
    passed: true,
    locales: ["en-US", "zh-CN"],
    themes: ["mycode-dark", "mycode-light"],
    previewAndExpandPreserved: true,
    contrast: "at least 4.5:1",
  };
}
