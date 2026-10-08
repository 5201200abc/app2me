import assert from "node:assert/strict";
import { join } from "node:path";
import { verifyConversationEdgeAlignment } from "./mycode-conversation-edge-alignment.mjs";
import { verifyTaskRowRefinement } from "./mycode-sidebar-refinement.mjs";

export async function verifyConversationDetailSettings(page, output) {
  await verifyConversationEdgeAlignment(page, output);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await verifyTaskRowRefinement(page, output);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByTestId("settings-page");
  await settings.waitFor();
  await settings.getByRole("button", { name: "常规", exact: true }).click();
  const language = await settings.getByText("界面语言", { exact: true }).boundingBox();
  const opener = await settings.getByText("默认文件打开位置", { exact: true }).boundingBox();
  assert.ok(opener.y > language.y && opener.y - language.y < 110);
  await settings.getByText("默认打开文件和文件夹的位置", { exact: true }).waitFor();
  await page.evaluate(async (cwd) => {
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const reactModule = await import(resources.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(
      resources.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url))
    );
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
    const { DefaultFileOpenLocationRow } = await load("settings/DefaultFileOpenLocationRow.tsx");
    const { WorkspaceEditorButtonGroup } = await load("WorkspaceEditorButtonGroup.tsx");
    const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
    const { PlatformProvider } = await load("hooks/usePlatform.tsx");
    const original = localStorage.getItem("mycode-last-editor-id");
    const { persistLastSelectedEditorId } = await load("lib/editorPreference.ts");
    persistLastSelectedEditorId("finder");
    const calls = [];
    const platform = {
      getInstalledEditors: async () =>
        ["finder", "sublime", "terminal", "vscode"].map((id) => ({
          id,
          name: id === "finder" ? "Finder" : id === "sublime" ? "Sublime Text" : id,
          iconDataUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
        })),
      openInEditor: async (...args) => {
        calls.push(args);
        return { success: true };
      },
    };
    const host = document.createElement("div");
    host.id = "default-opener-fixture";
    host.style.cssText =
      "position:fixed;left:340px;top:110px;width:650px;z-index:10000;background:var(--color-background);padding:16px";
    document.body.append(host);
    const root = createRoot(host);
    const render = () =>
      root.render(
        React.createElement(
          MyCodeIntlProvider,
          { initialLocale: "zh-CN" },
          React.createElement(
            PlatformProvider,
            { platform },
            React.createElement(
              React.Fragment,
              null,
              React.createElement(DefaultFileOpenLocationRow),
              React.createElement(
                "div",
                { "data-local-opener": "" },
                React.createElement(WorkspaceEditorButtonGroup, { workspaceAbsPath: "/fixture" }),
              ),
              React.createElement(
                "div",
                { "data-remote-opener": "" },
                React.createElement(WorkspaceEditorButtonGroup, {
                  workspaceAbsPath: "/remote",
                  remoteTarget: { kind: "ssh", host: "fixture-host", user: "fixture-user" },
                }),
              ),
            ),
          ),
        ),
      );
    render();
    window.__defaultOpenerFixture = { host, root, render, calls, original };
  }, process.cwd());
  const fixture = page.locator("#default-opener-fixture");
  try {
    const select = fixture.getByTestId("default-file-open-location");
    await select.waitFor();
    await select.click();
    await page.getByRole("option", { name: "Sublime Text", exact: true }).click();
    await fixture
      .locator("[data-local-opener]")
      .getByRole("button", { name: /Sublime Text/ })
      .waitFor();
    assert.equal(await page.evaluate(() => window.__defaultOpenerFixture.calls.length), 0);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("mycode-last-editor-id")),
      "sublime",
    );
    assert.equal(
      await fixture.getByRole("button", { name: "选择打开应用", exact: true }).count(),
      0,
    );
    await fixture.locator("[data-local-opener]").getByRole("button").click();
    assert.equal(await page.evaluate(() => window.__defaultOpenerFixture.calls[0][0]), "sublime");
    await fixture
      .locator("[data-remote-opener]")
      .getByRole("button", { name: /vscode/ })
      .waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("mycode-last-editor-id")),
      "sublime",
    );
    await page.screenshot({ path: join(output, "default-file-open-location.png") });
    await page.evaluate(() => window.__defaultOpenerFixture.render());
    await fixture
      .locator("[data-local-opener]")
      .getByRole("button", { name: /Sublime Text/ })
      .waitFor();
  } finally {
    await page.evaluate(() => {
      const { root, host, original } = window.__defaultOpenerFixture;
      root.unmount();
      host.remove();
      if (original === null) localStorage.removeItem("mycode-last-editor-id");
      else localStorage.setItem("mycode-last-editor-id", original);
      delete window.__defaultOpenerFixture;
    });
  }
}
