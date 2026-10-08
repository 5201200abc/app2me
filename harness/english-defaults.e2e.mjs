import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const bundle = await build({
  stdin: {
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MyCodeIntlProvider, useMyCodeIntl} from './packages/ui/src/i18n/IntlProvider.tsx';
function App(){
  const {locale, localePreference, setLocalePreference, intl} = useMyCodeIntl();
  return <><output id="locale">{locale}</output><output id="preference">{localePreference}</output>
    <output id="message">{intl.formatMessage({id:'sidebar.settings.locale.en-US'})}</output>
    <button id="chinese" onClick={()=>setLocalePreference('zh-CN')}>Chinese</button>
    <button id="system" onClick={()=>setLocalePreference('system')}>System</button>
    <button id="english" onClick={()=>setLocalePreference('en-US')}>English</button></>;
}
createRoot(document.getElementById('root')).render(<MyCodeIntlProvider><App/></MyCodeIntlProvider>);`,
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
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].contents);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="en"><div id="root"></div><script src="/fixture.js"></script></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const locale of ["zh-CN", "en-US"]) {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector("#locale")?.textContent === "en-US");
    assert.equal(await page.locator("#preference").textContent(), "en-US");
    assert.equal(await page.locator("#message").textContent(), "English");
    await page.locator("#chinese").click();
    await page.waitForFunction(() => document.querySelector("#locale")?.textContent === "zh-CN");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#locale")?.textContent === "zh-CN");
    await page.locator("#system").click();
    await page.waitForFunction(
      (expected) => document.querySelector("#locale")?.textContent === expected,
      locale,
    );
    assert.equal(await page.locator("#preference").textContent(), "system");
    await page.locator("#english").click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#locale")?.textContent === "en-US");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: fresh profiles default to English on Chinese and English hosts; explicit Chinese, system, and English preferences survive.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
