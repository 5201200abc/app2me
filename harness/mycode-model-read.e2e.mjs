import assert from "node:assert/strict";

export async function verifyModelReadOwner(page) {
  await page.evaluate(async (cwd) => {
    const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
    const reactModule = await import(urls.find((url) => /\/react\.js(?:\?|$)/.test(url)));
    const domModule = await import(urls.find((url) => /\/react-dom_client\.js(?:\?|$)/.test(url)));
    const React = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const { useModelSelectionServiceView } = await import(
      `/@fs/${cwd}/packages/ui/src/hooks/useModelSelectionView.ts`
    );
    const pending = [];
    const services = [0, 1].map((owner) => ({
      getView: (input) =>
        new Promise((resolve, reject) => pending.push({ owner, input, resolve, reject })),
      onDidChange: () => ({ dispose() {} }),
    }));
    const host = document.createElement("div");
    host.id = "model-read-owner-fixture";
    host.style.cssText =
      "position:fixed;top:20px;left:20px;z-index:10000;background:var(--color-background)";
    document.body.append(host);
    const root = createRoot(host);
    const view = (request, revision = 1) => ({
      revision,
      providers: [],
      effectiveSelection: request.input.selection,
    });
    window.__modelReadFixture = { root, host, pending, view };
    function Fixture() {
      const [input, setInput] = React.useState({
        selection: { providerId: "hf", modelId: "Qwen", options: { reasoningLevel: "high" } },
      });
      const [owner, setOwner] = React.useState(0);
      const [enabled, setEnabled] = React.useState(true);
      const read = useModelSelectionServiceView(services[owner], enabled, "remote-waiting", input);
      Object.assign(window.__modelReadFixture, { setInput, setOwner, setEnabled, read });
      return React.createElement(
        "div",
        { "data-status": read.state.status, "data-has-view": Boolean(read.state.view) },
        React.createElement(
          "button",
          { "data-testid": "read-fixture-refresh", onClick: read.reload },
          "retry",
        ),
        read.state.status === "ready" || read.state.status === "refreshing"
          ? React.createElement("input", { "data-testid": "read-fixture-range", type: "range" })
          : null,
      );
    }
    root.render(React.createElement(Fixture));
  }, process.cwd());
  const wait = async (status, count) => {
    await page.waitForFunction(
      ({ status, count }) =>
        window.__modelReadFixture?.read.state.status === status &&
        window.__modelReadFixture.pending.length >= count,
      { status, count },
    );
  };
  const select = async (model, reasoning) =>
    page.evaluate(
      ({ model, reasoning }) =>
        window.__modelReadFixture.setInput({
          selection: model
            ? { providerId: "hf", modelId: model, options: { reasoningLevel: reasoning } }
            : null,
        }),
      { model, reasoning },
    );
  const resolve = async (index, revision = 1) =>
    page.evaluate(
      ({ index, revision }) => {
        const f = window.__modelReadFixture;
        f.pending[index].resolve(f.view(f.pending[index], revision));
      },
      { index, revision },
    );
  const sameNode = async () =>
    assert.equal(
      await page.evaluate(
        () =>
          window.__modelReadFixture.range ===
          document.querySelector('[data-testid="read-fixture-range"]'),
      ),
      true,
    );
  try {
    await wait("loading", 1);
    await resolve(0);
    await wait("ready", 1);
    await page.evaluate(
      () =>
        (window.__modelReadFixture.range = document.querySelector(
          '[data-testid="read-fixture-range"]',
        )),
    );
    await select("Qwen", "low");
    await wait("refreshing", 2);
    await sameNode();
    await select("Qwen", "max");
    await wait("refreshing", 3);
    await resolve(2);
    await wait("ready", 3);
    await sameNode();
    await resolve(1, 100);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(
      await page.evaluate(
        () => window.__modelReadFixture.read.state.view.effectiveSelection.options.reasoningLevel,
      ),
      "max",
    );
    await select("Qwen", "low");
    await wait("refreshing", 4);
    await page.evaluate(() =>
      window.__modelReadFixture.pending[3].reject(new Error("fixture read failure")),
    );
    await page.waitForFunction(
      () =>
        window.__modelReadFixture.read.state.status === "refreshing" &&
        Boolean(window.__modelReadFixture.read.state.error),
    );
    await sameNode();
    await page.getByTestId("read-fixture-refresh").click();
    await wait("refreshing", 5);
    await resolve(4);
    await wait("ready", 5);
    await select("other", "low");
    await wait("loading", 6);
    assert.equal(await page.getByTestId("read-fixture-range").count(), 0);
    await resolve(5);
    await wait("ready", 6);
    await page.evaluate(() => window.__modelReadFixture.setOwner(1));
    await wait("loading", 7);
    assert.equal(await page.getByTestId("read-fixture-range").count(), 0);
    await resolve(6);
    await wait("ready", 7);
    await select(null, null);
    await wait("loading", 8);
    assert.equal(await page.getByTestId("read-fixture-range").count(), 0);
    await resolve(7);
    await wait("ready", 8);
    await page.evaluate(() => window.__modelReadFixture.setEnabled(false));
    await wait("unavailable", 8);
    assert.equal(await page.getByTestId("read-fixture-range").count(), 0);
  } finally {
    await page.evaluate(() => {
      const f = window.__modelReadFixture;
      f.root.unmount();
      f.host.remove();
      delete window.__modelReadFixture;
    });
  }
}
