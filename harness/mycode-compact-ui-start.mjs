export async function selectDesktopRenderer(app) {
  let page = await app.firstWindow();
  // 启动品牌窗会先于 renderer 出现；测试必须绑定主页面，不能在短暂的启动窗上等待组件。
  if (!page.url().startsWith("http://localhost:5186")) {
    const startupPage = page;
    page =
      app.windows().find((window) => window.url().startsWith("http://localhost:5186")) ??
      (await Promise.any([
        startupPage
          .waitForURL("http://localhost:5186/**", { timeout: 45000 })
          .then(() => startupPage),
        app.waitForEvent("window", {
          predicate: async (window) => {
            await window.waitForURL("http://localhost:5186/**", { timeout: 45000 });
            return true;
          },
        }),
      ]));
  }

  return page;
}

export async function prepareDesktopUi(
  page,
  isolatedPresentation = ["artifact-sources", "sources-sidebar"].some((scope) =>
    process.argv.includes(`--${scope}`),
  ),
) {
  await page.waitForLoadState("domcontentloaded");
  const start = page.getByRole("button", { name: /^(开始使用|Get started|Start using)$/ });
  if (isolatedPresentation) {
    // 此场景直接挂载实际组件并验证原生平台接口，不依赖用户数据库或模型配置。
    await page.waitForFunction(() =>
      performance
        .getEntriesByType("resource")
        .some((entry) => /\/react\.js(?:\?|$)/.test(entry.name)),
    );
  } else {
    await page.locator('[data-testid="composer-model-controls"]').or(start).waitFor();
    if (await start.isVisible()) await start.click();
    await page.locator('[data-testid="composer-model-controls"]').waitFor();
  }
}
