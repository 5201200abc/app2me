import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyAppearanceDetails(page, output) {
  const settings = page.getByTestId("settings-page");
  const theme = settings.getByRole("combobox").first();
  const font = settings.getByRole("group", { name: "界面字号", exact: true });
  const code = settings.getByRole("group", { name: "代码字号", exact: true });
  const initialCode = await code.locator("output").textContent();
  const initialFont = Number(await font.locator("output").textContent());
  for (const text of [
    "选择浅色、深色，或跟随系统",
    "调整应用界面文字的大小，图标和布局尺寸不变",
    "界面为浅色时，使用的语法高亮配色",
    "界面为深色时，使用的语法高亮配色",
    "在代码内容和差异视图（对比修改前后内容的视图）中显示行号",
    "代码行太长时自动折到下一行显示",
    "设置代码块、文件预览和差异视图的默认字号，不受界面字号影响",
  ])
    await settings.getByText(text, { exact: true }).waitFor();
  for (const text of ["浅色主题", "深色主题"])
    await settings.getByText(text, { exact: true }).waitFor();
  assert.equal(await theme.locator('[data-slot="select-value"] svg').count(), 0);
  assert.equal(await theme.locator("svg").count(), 1);
  const before = await font.getByRole("button").evaluateAll((items) =>
    items.map((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      icon: el.querySelector("svg").getBoundingClientRect().width,
    })),
  );
  await font.getByRole("button", { name: /-1 px$/ }).click();
  await page.waitForFunction(
    (value) =>
      Number(document.querySelector(".appearance-font-stepper output").textContent) === value,
    initialFont - 1,
  );
  const after = await font.getByRole("button").evaluateAll((items) =>
    items.map((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      icon: el.querySelector("svg").getBoundingClientRect().width,
    })),
  );
  assert.deepEqual(after, before);
  assert.equal(await code.locator("output").textContent(), initialCode);
  await font.getByRole("button", { name: /\+1 px$/ }).click();
  await page.waitForFunction(
    (value) =>
      Number(document.querySelector(".appearance-font-stepper output").textContent) === value,
    initialFont,
  );
  await code.getByRole("button", { name: /\+1 px$/ }).click();
  assert.equal(await code.locator("output").textContent(), "13");
  assert.equal(Number(await font.locator("output").textContent()), initialFont);
  assert.equal(await code.locator("..").getByText("px", { exact: true }).count(), 0);
  await code.getByRole("button", { name: /-1 px$/ }).click();
  assert.equal(await code.locator("output").textContent(), initialCode);
  for (const mode of ["浅色", "深色"]) {
    await theme.click();
    assert.equal(await page.getByRole("listbox").locator("svg:not(.lucide-check)").count(), 0);
    await page.getByRole("option", { name: mode, exact: true }).click();
    await page.waitForFunction(
      (expected) => document.documentElement.classList.contains(expected),
      mode === "浅色" ? "theme-mycode-light" : "theme-mycode-dark",
    );
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await font.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const number = el.querySelector("[data-font-size-value]");
        return {
          width: box.width,
          height: box.height,
          hasUnit: number.nextElementSibling !== null,
          tracking: getComputedStyle(number).letterSpacing,
          numbers: getComputedStyle(number).fontVariantNumeric,
          icons: [...el.querySelectorAll("svg")].map((svg) => ({
            width: svg.getBoundingClientRect().width,
            stroke: svg.getAttribute("stroke-width"),
          })),
          contained: [...el.querySelectorAll("button")].every((button) => {
            const b = button.getBoundingClientRect();
            return b.top >= box.top && b.bottom <= box.bottom;
          }),
        };
      });
      assert.equal(geometry.height, 26);
      assert.ok(geometry.width <= 64, JSON.stringify(geometry));
      assert.equal(geometry.hasUnit, false);
      assert.ok(["normal", "0px"].includes(geometry.tracking), JSON.stringify(geometry));
      assert.equal(geometry.numbers, "proportional-nums");
      assert.ok(geometry.contained);
      assert.ok(geometry.icons.every((icon) => icon.width === 12 && icon.stroke === "1.5"));
      assert.ok((await code.locator("..").boundingBox()).width <= 56);
      assert.equal(await settings.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await font.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(output, "appearance-polish-" + mode + "-" + width + ".png"),
      });
    }
  }
  await settings.getByRole("button", { name: "浏览器", exact: true }).click();
  for (const text of [
    "允许 AI 控制内置浏览器；仅对新会话生效。",
    "一次性把 Chrome 里的登录状态导入内置浏览器，之后 AI 可以直接打开你已登录的网站，不用再登录。点“导入”执行。",
    "只清除网页缓存（HTTP 缓存、Cache Storage、Service Worker），保留 Cookie 和本地站点数据。",
    "删除内置浏览器里的 Cookie、站点数据和缓存，已登录的网站需要重新登录。此操作不可撤销。",
    "开启后，内置浏览器访问 HTTPS 网站时不再检查证书是否可信，有被假冒网站或中间人窃听的风险。只影响内置浏览器，修改后需重启应用。",
  ])
    await settings.getByText(text, { exact: true }).waitFor();
  await settings
    .locator('[data-settings-capability="browser"]')
    .getByText("浏览器", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "browser-copy-polish.png") });
}
