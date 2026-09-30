import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";

// Render the production component with controlled props and production-built CSS.
// This checks layout/click targets, not host workflow execution.
const output = resolve(".artifacts/mycode-followup");
const assets = resolve("packages/desktop/out/renderer/assets");
const styles = (await readdir(assets)).filter((name) => /^styles-.*\.css$/.test(name));
assert.equal(styles.length, 1);
const css = await readFile(join(assets, styles[0]));
const bundle = await build({
  stdin: {
    contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MyCodeIntlProvider} from './packages/ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from './packages/ui/src/components/ui/tooltip.tsx';
import {Button} from './packages/ui/src/components/ui/button.tsx';
import {WorkflowCardHeader} from './packages/ui/src/components/workflow-timeline/WorkflowCardChrome.tsx';
function App(){const[expanded,setExpanded]=useState(false);window.clicked=[];return <MyCodeIntlProvider initialLocale="en-US"><TooltipProvider><main id="card" style={{padding:14,width:'100%',boxSizing:'border-box'}}><WorkflowCardHeader kind="Workflow" name={'Large workflow '.repeat(20)} detail={'240 actors · 120000 tokens · '.repeat(20)} expanded={expanded} onToggle={()=>setExpanded(!expanded)} onOpenDetails={()=>window.clicked.push('details')} trailing={<><Button size="icon-md" variant="ghost" aria-label="Configure" onClick={()=>window.clicked.push('configure')}>⚙</Button><Button size="icon-md" variant="ghost" aria-label="Stop" onClick={()=>window.clicked.push('stop')}>■</Button></>}/><output id="expanded">{String(expanded)}</output></main></TooltipProvider></MyCodeIntlProvider>};
createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  tsconfig: "packages/ui/tsconfig.json",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles[0].contents;
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(js);
  } else if (req.url === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html class="dark theme-mycode-dark"><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  results = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const width of [300, 390, 520, 900]) {
    await page.setViewportSize({ width, height: 200 });
    await page.getByTestId("workflow-card-header").waitFor();
    const geometry = await page.getByTestId("workflow-card-header").evaluate((header) => {
      const rect = header.getBoundingClientRect();
      return {
        width: window.innerWidth,
        left: rect.left,
        right: rect.right,
        buttons: [...header.querySelectorAll("button")].map((button) => {
          const r = button.getBoundingClientRect();
          return { label: button.getAttribute("aria-label"), left: r.left, right: r.right };
        }),
      };
    });
    assert.equal(geometry.buttons.length, 4);
    for (const button of geometry.buttons) {
      assert.ok(
        button.left >= geometry.left - 1 && button.right <= geometry.right + 1,
        JSON.stringify(geometry),
      );
    }
    results.push(geometry);
    await page.screenshot({ path: join(output, `workflow-card-${width}.png`) });
  }
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByTestId("workflow-card-header").locator("button").nth(2).click();
  assert.deepEqual(await page.evaluate(() => window.clicked), ["configure", "stop", "details"]);
  await page.getByTestId("workflow-card-header").locator("button").nth(3).click();
  assert.equal(await page.locator("#expanded").textContent(), "true");
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "workflow-card-layout.json"),
    JSON.stringify({ passed: true, errors, results }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, widths: results.map((row) => row.width), clicks: 4 }));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
