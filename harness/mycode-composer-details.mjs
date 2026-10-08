import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

export async function verifyComposerChrome(page) {
  assert.equal(await page.getByTestId("terminal-toggle").count(), 0);
  assert.equal(await page.getByTestId("v4-composer-cua-entry").count(), 0);
  const toggle = page.getByTestId("side-pane-toggle");
  const checkIcon = async () => {
    const icon = toggle.locator("svg");
    assert.equal((await icon.boundingBox()).width, 14);
    assert.equal(await icon.getAttribute("stroke-width"), "1.5");
    assert.equal(await icon.locator("path").count(), 1);
  };
  await checkIcon();
  await toggle.click();
  await checkIcon();
  await toggle.click();
  await checkIcon();
}

export async function verifySettingsCopy(settings) {
  for (const text of [
    "设置应用界面显示的语言",
    "同步系统终端环境",
    "内置终端启动时，沿用本机的登录 shell 环境、代理设置、Kube 变量和终端字体。",
    "增强查找和搜索命令",
    "在新建会话和重启应用后恢复的会话中，使用增强版的文件查找（Find）和内容搜索（Grep）。已打开的会话保持原设置，Windows 上的 Find 不受影响。",
  ])
    await settings.getByText(text, { exact: true }).waitFor();
  const font = settings.getByPlaceholder("没有填写内容默认自动同步", { exact: true });
  await font.waitFor();
  const geometry = await font.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    width: el.getBoundingClientRect().width,
    font: getComputedStyle(el).fontSize,
    radius: getComputedStyle(el).borderRadius,
  }));
  assert.ok(
    geometry.height === 28 &&
      geometry.width <= 480 &&
      geometry.font === "12px" &&
      geometry.radius === "6px",
    JSON.stringify(geometry),
  );
  const row = font.locator("xpath=ancestor::div[.//button][1]");
  const save = row.getByRole("button", { name: "保存", exact: true });
  await font.fill("monospace");
  await font.press("Enter");
  await save.waitFor();
  await settings.page().waitForFunction((button) => button.disabled, await save.elementHandle());
  assert.equal(await font.inputValue(), "monospace");
  await font.fill("");
  await save.click();
  await settings.page().waitForFunction((button) => button.disabled, await save.elementHandle());
}

export async function verifyThoughtStability(
  page,
  output,
  scope = page.getByTestId("v4-composer"),
  name = "local",
) {
  const inModelMenu = name.startsWith("local");
  if (inModelMenu) {
    const controls = scope.getByTestId("composer-model-controls");
    assert.equal(await controls.getByRole("button").count(), 1);
    const model = controls.getByTestId("chat-model-select-trigger");
    assert.equal(await model.locator("[data-composer-thought-summary]").count(), 1);
    assert.equal(await model.locator("svg.lucide-chevron-down").count(), 1);
    await model.click();
  }
  const trigger = (inModelMenu ? page : scope).getByTestId("chat-thought-level-select-trigger");
  await trigger.click();
  const popup = page.getByTestId("thought-strength-popover");
  await popup.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="thought-strength-popover"]')
      ?.getAnimations()
      .every((a) => a.playState !== "running"),
  );
  const appearance = await popup.evaluate((el) => {
    const range = el.querySelector('input[type="range"]');
    const style = getComputedStyle(range);
    const thumb = getComputedStyle(range, "::-webkit-slider-thumb");
    return {
      actions: [...el.querySelectorAll("[data-strength-action]")].map((button) => ({
        width: button.getBoundingClientRect().width,
        icon: button.querySelector("svg").getBoundingClientRect().width,
        stroke: button.querySelector("svg").getAttribute("stroke-width"),
      })),
      label: getComputedStyle(el.querySelector("[data-strength-value]")).fontSize,
      height: style.height,
      border: style.borderWidth,
      radius: style.borderRadius,
      thumb: thumb.width,
      transition: style.transitionProperty,
      ticks: [...el.querySelectorAll("[data-strength-tick]")].map(
        (tick) => tick.getBoundingClientRect().width,
      ),
    };
  });
  assert.ok(
    appearance.actions.length === 2 &&
      appearance.actions.every((a) => a.width === 20 && a.icon === 12 && a.stroke === "1.5"),
    JSON.stringify(appearance),
  );
  assert.equal(appearance.label, "11px");
  assert.equal(appearance.height, "10px");
  assert.match(appearance.transition, /--thought-strength-position/);
  assert.match(appearance.transition, /--thought-strength-color/);
  assert.equal(appearance.border, "0px");
  assert.ok(parseFloat(appearance.radius) >= 4);
  assert.ok(appearance.ticks.every((width) => width === 2));
  assert.equal(await trigger.getAttribute("aria-label"), "Effort Level");
  assert.doesNotMatch(await popup.innerText(), /Qwen|DeepSeek|Flash|Pro/);
  const range = popup.getByRole("slider");
  const max = Number(await range.getAttribute("max"));
  const results = [];
  for (const width of [390, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.evaluate((fixture) => {
      const nodes = fixture
        ? [
            ...document.querySelectorAll(
              "#composer-detail-fixture button, #composer-detail-fixture input, [data-testid='thought-strength-popover']",
            ),
          ]
        : [
            ...document.querySelectorAll(
              "[data-prompt-editor-shell], [data-testid='v4-composer'] button, [data-slot='dropdown-menu-content'], [data-testid='thought-strength-popover']",
            ),
          ];
      const measure = () =>
        nodes
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const b = el.getBoundingClientRect();
            return {
              id: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.tagName,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
            };
          });
      const samples = [measure()];
      let frame;
      const sample = () => {
        samples.push(measure());
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      window.__thoughtGeometry = {
        samples,
        finish: () => {
          cancelAnimationFrame(frame);
          return samples;
        },
      };
    }, !name.startsWith("local"));
    await range.focus();
    await range.press("Home");
    for (let index = 0; index <= max; index++) {
      if (index) await range.press("ArrowRight");
      await page.waitForFunction(
        (index) =>
          Number(
            document.querySelector('[data-testid="thought-strength-popover"] input[type="range"]')
              ?.value,
          ) === index,
        index,
      );
      const expectedLabel = {
        low: "Low",
        medium: "Medium",
        high: "High",
        xhigh: "Extra High",
        max: "Max",
      }[await range.getAttribute("aria-valuetext")];
      if (expectedLabel)
        assert.equal(await popup.locator("[data-strength-value]").innerText(), expectedLabel);
      const expectedColor = {
        Low: "rgb(156, 163, 175)",
        Medium: "rgb(59, 130, 246)",
        High: "rgb(234, 179, 8)",
        "Extra High": "rgb(249, 115, 22)",
        Max: "rgb(220, 38, 38)",
      }[expectedLabel];
      if (expectedColor)
        await page.waitForFunction((color) => {
          const popup = document.querySelector('[data-testid="thought-strength-popover"]');
          return (
            getComputedStyle(popup.querySelector("[data-strength-value]")).color === color &&
            getComputedStyle(popup.querySelector('input[type="range"]'))
              .getPropertyValue("--thought-strength-color")
              .trim() === color
          );
        }, expectedColor);
    }
    let b = await range.boundingBox();
    await page.mouse.click(b.x + 8, b.y + b.height / 2);
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector('[data-testid="thought-strength-popover"] input[type="range"]')
            ?.value,
        ) === 0,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    b = await range.boundingBox();
    await page.mouse.move(b.x + 8, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 8, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      (max) =>
        Number(
          document.querySelector('[data-testid="thought-strength-popover"] input[type="range"]')
            .value,
        ) === max,
      max,
      { timeout: 5000 },
    );
    const thinking = popup.getByRole("button", { name: "no thinking", exact: true });
    await thinking.click();
    await popup.getByRole("button", { name: "thinking", exact: true }).waitFor();
    await popup.getByRole("button", { name: "thinking", exact: true }).click();
    await popup.getByRole("button", { name: "恢复默认强度", exact: true }).click();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const samples = await page.evaluate(() => window.__thoughtGeometry.finish());
    const baseline = samples[0];
    for (const sample of samples) {
      assert.equal(sample.length, baseline.length);
      sample.forEach((rect, index) => {
        assert.equal(rect.id, baseline[index].id);
        for (const field of ["x", "y", "width", "height"])
          assert.ok(
            Math.abs(rect[field] - baseline[index][field]) <= 0.75,
            `${name} ${width}: ${rect.id} ${field} shifted`,
          );
      });
    }
    results.push({ width, frames: samples.length, baseline });
    await page.screenshot({ path: join(output, `thought-stable-${name}-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await range.evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await writeFile(
    join(output, `thought-stability-${name}.json`),
    JSON.stringify({ passed: true, appearance, results }, null, 2),
  );
  await page.keyboard.press("Escape");
  if (inModelMenu) {
    await popup.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "v4-composer-input",
    );
  }
  await page.evaluate(() => delete window.__thoughtGeometry);
}

export async function verifyContextPlacement(page, output) {
  await page.evaluate(async (cwd) => {
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(
      resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
    );
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const url = `/@fs/${cwd}/packages/ui/src/v4/composer/V4ComposerSubmitControls.tsx`;
    const { V4ComposerSubmitControls } = await import(url);
    const source = await fetch(url).then((r) => r.text());
    const intlUrl = source.match(/import\s*\{\s*useMyCodeIntl\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
    const { MyCodeIntlProvider } = await import(intlUrl);
    const { TooltipProvider } = await import(
      `/@fs${cwd}/packages/ui/src/components/ui/tooltip.tsx`
    );
    const { ThoughtLevelSlider } = await import(
      `/@fs/${cwd}/packages/ui/src/chat-input-toolbar/ThoughtLevelSlider.tsx`
    );
    const host = document.createElement("div");
    host.id = "composer-detail-fixture";
    host.style.cssText =
      "position:fixed;top:160px;left:16px;width:min(680px,calc(100vw - 32px));z-index:10000;background:var(--color-background);padding:12px;display:flex;align-items:center;justify-content:space-between";
    document.body.append(host);
    const root = createRoot(host);
    function Fixture() {
      const ref = React.useRef(null);
      const [value, setValue] = React.useState("high");
      const [usage, setUsage] = React.useState({
        contextWindow: { usedTokens: 26000, maxTokens: 262144 },
      });
      window.__detailFixture.updateUsage = setUsage;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ThoughtLevelSlider, {
          option: {
            id: "thought",
            category: "thought_level",
            type: "select",
            currentValue: value,
            defaultValue: "high",
            options: ["low", "high", "max", "disabled"].map((v) => ({ name: v, value: v })),
          },
          onValueChange: (v) => {
            window.__detailFixture.values.push(v);
            setValue(v);
          },
          triggerRef: ref,
        }),
        React.createElement(
          V4ComposerSubmitControls,
          { usage, disabled: false },
          React.createElement(
            "button",
            { "data-testid": "fixture-send", style: { width: 28, height: 28 } },
            "↑",
          ),
        ),
      );
    }
    window.__detailFixture = { root, host, values: [] };
    root.render(
      React.createElement(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        React.createElement(TooltipProvider, null, React.createElement(Fixture)),
      ),
    );
  }, process.cwd());
  const fixture = page.locator("#composer-detail-fixture");
  try {
    const usage = fixture.getByTestId("chat-context-usage-trigger");
    await usage.waitFor();
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const [u, s] = await Promise.all([
        usage.boundingBox(),
        fixture.getByTestId("fixture-send").boundingBox(),
      ]);
      assert.equal(await usage.count(), 1);
      assert.ok(u.x + u.width <= s.x && s.x - u.x - u.width <= 5 && Math.abs(u.y - s.y) <= 5);
      await page.screenshot({ path: join(output, `context-placement-${width}.png`) });
    }
    await usage.hover();
    await page
      .getByText(/26K|26k|26,000|2.6万/)
      .first()
      .waitFor();
    await page.mouse.move(1, 950);
    await verifyThoughtStability(page, output, fixture, "deepseek");
    const values = await page.evaluate(() => window.__detailFixture.values);
    assert.ok(["low", "high", "max", "disabled"].every((value) => values.includes(value)));
    assert.equal(values.at(-1), "high");
    await page.evaluate(() => window.__detailFixture.updateUsage(null));
    await usage.waitFor({ state: "detached" });
  } finally {
    await page.evaluate(() => {
      window.__detailFixture.root.unmount();
      window.__detailFixture.host.remove();
      delete window.__detailFixture;
    });
  }
}
