import assert from "node:assert/strict";
import { join } from "node:path";
import { mountConversationFixture } from "./mycode-conversation-fixture.mjs";

export async function verifyGoalThreadsAndSpacing(page, cwd, output) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(async (cwd) => {
    const { React, createRoot } = await import(`/@fs${cwd}/harness/mychat-mode-bootstrap.ts`);
    const load = (path) => import(`/@fs${cwd}/packages/ui/src/${path}`);
    const { ChatPromptActionMenu } = await load("prompt-editor/ChatPromptActionMenu.tsx");
    const { LexicalChatInput } = await load("LexicalChatInput.tsx");
    const { MyCodeIntlProvider } = await load("i18n/IntlProvider.tsx");
    const { PlatformProvider } = await load("hooks/usePlatform.tsx");
    const { ServiceProvider } = await load("hooks/useServices.tsx");
    const { TabStoreProvider } = await load("store/TabStoreProvider.tsx");
    const { TooltipProvider } = await load("components/ui/tooltip.tsx");
    const { useRemoteWorkspaceSessionStore } = await load("store/remoteWorkspaceSessionStore.ts");
    const host = document.createElement("div");
    host.id = "goal-thread-fixture";
    host.style.cssText =
      "position:fixed;inset:0;z-index:40;background:var(--color-background);padding:64px";
    document.body.append(host);
    const h = React.createElement;
    function Fixture() {
      const [sessionId, setSessionId] = React.useState(null);
      const api = React.useRef(null);
      const [container, setContainer] = React.useState(null);
      window.__goalThreadFixture = { setSessionId, api };
      return h(
        "div",
        { ref: setContainer },
        h(LexicalChatInput, {
          workspacePath: "/fixture/goals",
          taskId: sessionId,
          editorApiRef: api,
          inputTestId: "goal-thread-input",
          onSubmit: () => false,
          enableMentionPanel: false,
        }),
        h(ChatPromptActionMenu, {
          actionMenuTitle: "添加上下文",
          workspacePath: "/fixture/goals",
          sessionId,
          inputApiRef: api,
          container,
          showPlugins: false,
        }),
      );
    }
    const root = createRoot(host);
    root.render(
      h(
        MyCodeIntlProvider,
        { initialLocale: "zh-CN" },
        h(
          PlatformProvider,
          { platform: {} },
          h(
            ServiceProvider,
            { services: useRemoteWorkspaceSessionStore.getState().baseServices },
            h(TabStoreProvider, null, h(TooltipProvider, null, h(Fixture))),
          ),
        ),
      ),
    );
    window.__goalThreadFixtureRoot = root;
  }, cwd);
  const fixture = page.locator("#goal-thread-fixture");
  const input = fixture.getByTestId("goal-thread-input");
  await input.waitFor();
  for (const sessionId of [null, "existing-thread", "fork-thread", "selection-side-thread"]) {
    await page.evaluate((id) => {
      window.__goalThreadFixture.setSessionId(id);
      window.__goalThreadFixture.api.current.setText("");
    }, sessionId);
    await fixture.getByRole("button", { name: "添加上下文", exact: true }).click();
    await page.getByTestId("add-goal").click();
    await page.waitForFunction(
      () => window.__goalThreadFixture.api.current.getText().trim() === "/goal",
    );
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => window.__goalThreadFixture.api.current.setText("保留正文"));
  await fixture.getByRole("button", { name: "添加上下文", exact: true }).click();
  assert.equal(await page.getByTestId("add-goal").count(), 0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__goalThreadFixtureRoot.unmount();
    document.getElementById("goal-thread-fixture").remove();
  });

  await mountConversationFixture(page, `${cwd}/pelican-bicycle-v2.html`);
  await page.evaluate(() =>
    window.__conversationFixture.render({ timeline: true, includeLiveTail: false }),
  );
  const stage = page.locator("#conversation-presentation-fixture");
  const composer = stage.locator("[data-fixture-composer]");
  await composer.waitFor();
  for (const width of [390, 1200, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await stage.locator("[data-v4-timeline-scroll]").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const geometry = await stage.evaluate((el) => {
      const composer = el.querySelector("[data-fixture-composer]").getBoundingClientRect();
      const dock = getComputedStyle(el.querySelector("[data-v4-composer-dock-content]"));
      const layer = el.querySelector("[data-v4-timeline-message-layer]").getBoundingClientRect();
      const artifact = el.querySelector("[data-conversation-file-summary]");
      return {
        padding: dock.paddingTop,
        gap: composer.top - layer.bottom,
        composerLeft: composer.left,
        composerRight: composer.right,
        artifact: artifact?.getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(geometry.padding, "24px");
    assert.ok(geometry.gap >= 23, JSON.stringify(geometry));
    assert.ok(geometry.composerLeft >= 0 && geometry.composerRight <= width);
  }
  await page.setViewportSize({ width: 1200, height: 480 });
  await stage.locator("[data-v4-timeline-scroll]").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const finalGap = await stage.evaluate((el) => {
    const artifact = el.querySelector("[data-conversation-file-summary]").getBoundingClientRect();
    const composer = el.querySelector("[data-fixture-composer]").getBoundingClientRect();
    return {
      gap: composer.top - artifact.bottom,
      artifactTop: artifact.top,
      width: artifact.width,
      composerWidth: composer.width,
    };
  });
  assert.ok(finalGap.gap >= 24 && finalGap.gap <= 80, JSON.stringify(finalGap));
  assert.ok(finalGap.artifactTop >= 0);
  assert.equal(finalGap.width, finalGap.composerWidth);
  await page.screenshot({ path: join(output, "final-artifacts-spacing.png") });
  await page.evaluate(() => {
    window.__conversationFixture.root.unmount();
    window.__conversationFixture.host.remove();
  });
  return true;
}
