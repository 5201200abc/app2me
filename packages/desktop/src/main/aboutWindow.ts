import { MYCODE_BRAND_PATHS, MYCODE_BRAND_VIEW_BOX } from "@mycode/shared";

interface CustomAboutDialogHtmlInput {
  applicationName: string;
  appVersion: string;
  copyright: string;
  versionLabel: string;
  okButtonLabel: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createCustomAboutDialogHtml(input: CustomAboutDialogHtmlInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <title>${escapeHtml(input.applicationName)}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        --about-bg: #f7f7f7;
        --about-text: #505054;
        --about-subtle: #858589;
        --about-button: #eeeeef;
        --about-border: rgba(0, 0, 0, .08);
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--about-bg); }
      body { user-select: none; }
      .about-window { height: 100%; padding: 20px; }
      .about-card {
        height: 100%; display: flex; flex-direction: column; align-items: center;
        color: var(--about-text); -webkit-app-region: drag;
      }
      .app-logo { width: 40px; height: 40px; color: var(--about-subtle); opacity: .65; }
      .title { margin: 12px 0 0; font-size: 13px; line-height: 20px; font-weight: 500; }
      .version { margin: 4px 0 0; color: var(--about-subtle); font-size: 12px; line-height: 18px; }
      .meta { margin: 12px 0 0; color: var(--about-subtle); font-size: 11px; line-height: 18px; }
      .ok-button {
        width: 100%; height: 28px; margin-top: auto; border: 1px solid var(--about-border);
        border-radius: 8px; background: var(--about-button); color: var(--about-text);
        font: inherit; font-size: 12px; cursor: default; -webkit-app-region: no-drag;
      }
      .ok-button:hover { filter: brightness(.97); }
      .ok-button:focus-visible { outline: 1px solid var(--about-subtle); outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        :root {
          --about-bg: #1e1e1e; --about-text: #c2c2c5; --about-subtle: #919195;
          --about-button: #282828; --about-border: rgba(255, 255, 255, .09);
        }
      }
    </style>
  </head>
  <body>
    <main class="about-window">
      <section class="about-card" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <svg class="app-logo" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="${MYCODE_BRAND_VIEW_BOX}" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
          ${MYCODE_BRAND_PATHS.map((path) => `<path d="${path}" />`).join("")}
        </svg>
        <h1 id="about-title" class="title">${escapeHtml(input.applicationName)}</h1>
        <p class="version">${escapeHtml(input.versionLabel)} ${escapeHtml(input.appVersion)}</p>
        <p class="meta">${escapeHtml(input.copyright)}</p>
        <button class="ok-button" type="button" autofocus>${escapeHtml(input.okButtonLabel)}</button>
      </section>
    </main>
    <script>
      const closeWindow = () => window.close();
      document.querySelector(".ok-button")?.addEventListener("click", closeWindow);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          closeWindow();
        }
      });
    </script>
  </body>
</html>`;
}
