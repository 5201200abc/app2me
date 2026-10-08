import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { mountCapabilitySettingsFixture } from "./mycode-capability-settings-fixture.mjs";

export async function verifyCapabilitySettings(page, output, app) {
  await page.evaluate(mountCapabilitySettingsFixture, process.cwd());
  const fixture = page.locator("#capability-settings-fixture");
  const toggle = () => fixture.locator('[data-computer-use-settings] [role="switch"]');
  const calls = () => page.evaluate(() => window.__capabilityFixture.state.calls);
  const configure = async (options = {}) => {
    await page.evaluate((o) => window.__capabilityFixture.configure(o), options);
    await toggle().waitFor();
    if (!options.windows)
      await page.waitForFunction(() => window.__capabilityFixture.snapshot().fresh);
  };
  const checked = async (value) => {
    await page.waitForFunction(
      (v) =>
        document
          .querySelector('[data-computer-use-settings] [role="switch"]')
          .getAttribute("aria-checked") === String(v) &&
        document
          .querySelector('[data-computer-use-settings] [role="switch"]')
          .getAttribute("aria-busy") === "false",
      value,
    );
  };
  const expectClosed = async () => {
    await checked(false);
    assert.equal(
      (await calls()).some((c) => c.action === "plugin" && c.enabled === true),
      false,
    );
  };
  const missing = { accessibility: "denied", screenRecording: "denied" };
  const scenarios = [];
  await configure({ probe: true });
  assert.equal(await fixture.locator('[data-computer-use-settings] [role="switch"]').count(), 1);
  assert.equal(await fixture.getByText("辅助功能 (Accessibility)", { exact: true }).count(), 0);
  await toggle().click();
  await checked(true);
  assert.equal((await calls()).filter((c) => c.action === "onboarding").length, 0);
  await page.waitForFunction(() => document.querySelector('[data-entry-visible="true"]'));
  assert.equal(await page.evaluate(() => window.__capabilityFixture.state.settingsReads), 0);
  await toggle().click();
  await checked(false);
  await page.waitForFunction(() => document.querySelector('[data-entry-visible="false"]'));
  scenarios.push("已授权直接开启/关闭；旧隐藏偏好不阻挡同一插件入口");

  for (const [name, permissions, result] of [
    ["双权限授权", missing, {}],
    ["仅屏幕录制缺失", { accessibility: "granted", screenRecording: "denied" }, {}],
    ["授权取消", missing, { success: false, canceled: true }],
    ["授权未完成", missing, {}],
    ["重启失败", missing, {}],
  ]) {
    await configure({ permissions, failRestart: name === "重启失败" });
    await toggle().click();
    await page
      .waitForFunction(() => typeof window.__capabilityFixture.state.finish === "function")
      .catch(async (e) => {
        throw Error(
          name +
            ": " +
            JSON.stringify(
              await page.evaluate(() => ({
                state: window.__capabilityFixture.state,
                snapshot: window.__capabilityFixture.snapshot(),
                text: document.body.innerText,
              })),
            ) +
            e.message,
        );
      });
    assert.equal(await toggle().getAttribute("aria-checked"), "false");
    assert.equal(await toggle().isEnabled(), false);
    const onboarding = (await calls()).filter((c) => c.action === "onboarding");
    assert.equal(onboarding.length, 1);
    assert.deepEqual(
      onboarding[0].requiredPermissions,
      name === "仅屏幕录制缺失" ? ["screen_recording"] : ["accessibility", "screen_recording"],
    );
    await page.evaluate(
      ({ name, result }) =>
        window.__capabilityFixture.complete(
          name === "授权未完成"
            ? { accessibility: "granted", screenRecording: "denied" }
            : window.__capabilityFixture.granted(),
          result,
        ),
      { name, result },
    );
    if (["授权取消", "授权未完成", "重启失败"].includes(name)) await expectClosed();
    else {
      await checked(true);
      const events = await calls();
      assert.equal(events.filter((c) => c.action === "restart").length, 1);
      assert.ok(
        events.findIndex((c) => c.action === "restart") <
          events.findIndex((c) => c.action === "plugin" && c.enabled),
      );
    }
    scenarios.push(name);
  }
  for (const [name, options] of [
    ["未知权限", { permissions: { accessibility: "unknown", screenRecording: "unknown" } }],
    ["权限查询失败", { failStatus: true }],
    ["插件保存失败", { failPlugin: true }],
    ["授权窗口失败", { permissions: missing, failOnboarding: true }],
  ]) {
    await page.evaluate((o) => window.__capabilityFixture.configure(o), options);
    await toggle().waitFor();
    await toggle().click();
    if (name === "插件保存失败") {
      await checked(false);
      assert.equal(await page.evaluate(() => window.__capabilityFixture.state.enabled), false);
    } else await expectClosed();
    scenarios.push(name);
  }
  await configure({
    enabled: true,
    permissions: { accessibility: "unknown", screenRecording: "unknown" },
  });
  await toggle().click();
  await expectClosed();
  assert.equal(await page.evaluate(() => window.__capabilityFixture.state.enabled), false);
  scenarios.push("旧配置已启用但权限未知：尝试开启时先真正关闭插件，失败不恢复开启");
  await configure({ permissions: missing });
  await toggle().click();
  await page.waitForFunction(() => !!window.__capabilityFixture.state.finish);
  await page.evaluate(() => {
    const f = window.__capabilityFixture;
    f.render({ path: "/fixture/changed-workspace" });
  });
  await page.waitForFunction(() =>
    window.__capabilityFixture.state.calls.some((c) => c.action === "cancel"),
  );
  await page.evaluate(() => window.__capabilityFixture.complete());
  await expectClosed();
  scenarios.push("授权期间切换工作区取消旧操作，不启用新工作区");
  await configure({ permissions: missing });
  await toggle().click();
  await page.waitForFunction(() => !!window.__capabilityFixture.state.finish);
  await page.evaluate(() => window.__capabilityFixture.unmountSection());
  await page.waitForFunction(() =>
    window.__capabilityFixture.state.calls.some((c) => c.action === "cancel"),
  );
  await page.evaluate(() => window.__capabilityFixture.complete());
  assert.equal(
    (await calls()).some((c) => c.action === "plugin" && c.enabled),
    false,
  );
  scenarios.push("授权期间卸载取消原生 participant");
  await configure({ enabled: true });
  await checked(true);
  await page.evaluate(() => {
    window.__capabilityFixture.state.permissions = {
      accessibility: "denied",
      screenRecording: "granted",
    };
    window.dispatchEvent(new Event("focus"));
  });
  await checked(false);
  assert.equal((await calls()).filter((c) => c.action === "plugin" && !c.enabled).length, 1);
  scenarios.push("真实新鲜缺权关闭旧启用态，无重复保存");
  await configure({ windows: true });
  await toggle().click();
  await checked(true);
  assert.equal(
    (await calls()).filter((c) => ["status", "onboarding", "restart"].includes(c.action)).length,
    0,
  );
  scenarios.push("Windows 仅启停插件，不调用 macOS 权限服务");
  await configure({ belowFloor: true });
  await page.waitForFunction(
    () => document.querySelector('[data-computer-use-settings] [role="switch"]').disabled,
  );
  assert.equal(await toggle().getAttribute("aria-checked"), "false");
  scenarios.push("低版本 macOS 禁止开启");

  await configure({ browser: true });
  const browser = fixture.locator("[data-browser-fixture]");
  const bt = browser.locator('[data-settings-capability="browser"] [role="switch"]');
  await bt.waitFor();
  await bt.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-settings-capability="browser"] [role="switch"]')
        .getAttribute("aria-checked") === "true",
  );
  assert.equal(
    (await calls()).filter(
      (c) => c.action === "plugin" && c.pluginId.startsWith("browser-use") && c.enabled,
    ).length,
    1,
  );
  const importRow = browser
    .locator('[data-browser-operation="import"]')
    .locator("xpath=ancestor::div[contains(@class,'border-t')][1]");
  assert.equal(await importRow.evaluate((e) => e.parentElement.firstElementChild === e), true);
  await browser.locator('[data-browser-operation="clear-all"]').click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await calls()).filter((c) => c.action === "clear").length, 0);
  await browser.locator('[data-browser-operation="clear-cache"]').click();
  await page.waitForFunction(() =>
    window.__capabilityFixture.state.calls.some((c) => c.action === "clear"),
  );
  await browser.locator('[data-browser-operation="import"]').click();
  await page.waitForFunction(() =>
    window.__capabilityFixture.state.calls.some((c) => c.action === "import"),
  );
  scenarios.push("浏览器单开关、数据首项导入、原清理与确认取消回调");

  // 行为测试完成后重新挂载干净的展示场景，等待原错误提示自然消失。
  await configure({ browser: true, enabled: true, browserEnabled: true });
  await page.waitForFunction(() => !document.getElementById("mycode-toast-host")?.innerText.trim());
  const win = await app.browserWindow(page);
  const cdp = await page.context().newCDPSession(page);
  const screenshots = [];
  for (const locale of ["zh-CN", "en-US"])
    for (const theme of ["mycode-dark", "mycode-light"])
      for (const width of [390, 1100])
        for (const scale of [1, 2]) {
          await page.evaluate(
            ({ locale, theme }) => {
              const f = window.__capabilityFixture;
              f.applyTheme(theme);
              f.render({ locale });
            },
            { locale, theme },
          );
          await win.evaluate(
            (w, { width, scale }) => {
              w.setBounds({ width: width * scale, height: 1100 * scale });
              w.webContents.setZoomFactor(scale);
            },
            { width, scale },
          );
          await bt.waitFor();
          await page.waitForFunction((width) => Math.abs(window.innerWidth - width) < 2, width);
          await fixture.evaluate(async (el) => {
            await new Promise(requestAnimationFrame);
            await Promise.all(
              el
                .getAnimations({ subtree: true })
                .filter((a) => Number.isFinite(a.effect.getComputedTiming().endTime))
                .map((a) => a.finished),
            );
          });
          const metrics = await fixture.evaluate((el) => {
            const rows = [...el.querySelectorAll("[data-settings-capability]")];
            const overlap = rows.some((row) => {
              const items = [...row.children].slice(0, 3).map((e) => e.getBoundingClientRect());
              return items[0].right > items[1].left || items[1].right > items[2].left;
            });
            const button = el.querySelector('[data-settings-capability="browser"] [role="switch"]');
            const probe = document.createElement("span");
            probe.style.color = "var(--color-brand)";
            el.append(probe);
            const expectedBrand = getComputedStyle(probe).color;
            probe.remove();
            return {
              expectedBrand,
              overflow: el.scrollWidth > el.clientWidth + 1,
              overlap,
              background: getComputedStyle(button).backgroundColor,
              viewport: window.innerWidth,
              brand: getComputedStyle(el).getPropertyValue("--color-brand").trim(),
            };
          });
          assert.equal(metrics.overflow, false);
          assert.equal(metrics.overlap, false);
          assert.equal(metrics.background, metrics.expectedBrand);
          const captured = await cdp.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          await writeFile(
            join(output, `control-browser-${locale}-${theme}-${width}-${scale}x.png`),
            Buffer.from(captured.data, "base64"),
          );
          screenshots.push({ locale, theme, width, scale, ...metrics });
        }
  await configure({ browser: true, windows: true });
  assert.equal(await browser.locator('[data-browser-operation="import"]').count(), 0);
  scenarios.push("中英文、深浅色、390/1100 宽度与 1x/2x 缩放；Windows 导入仍隐藏");
  await page.evaluate(() => window.__capabilityFixture.configure({ remote: true }));
  await fixture.getByText("当前环境暂不支持计算机使用", { exact: true }).waitFor();
  assert.equal(await fixture.getByRole("switch").count(), 0);
  assert.equal(
    (await calls()).filter((c) => c.action === "onboarding" || c.action === "plugin").length,
    0,
  );
  scenarios.push("远端仅展示不可用说明，不触发本机写操作");
  return { passed: true, scenarios, screenshots };
}
