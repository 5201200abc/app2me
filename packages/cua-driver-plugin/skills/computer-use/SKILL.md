---
name: computer-use
description: Inspect and operate native desktop applications using the host-provided Cua Driver MCP tools.
---

# Computer Use

Use the `cua_driver` MCP server for native desktop work. Read its bundled skill resources and tool schemas before acting. The server supplies the current supported operations; do not guess API names or use the retired node_repl CUA bridge.

Observe the actual application or window before each interaction. Re-observe after actions and use fresh element references. Use the desktop application's visible result to verify completion. Keep the host's native authorization and capability decisions intact.

The MyCode built-in browser remains the browser automation surface. Use its browser skill for web tasks; native desktop control does not replace or launch another browser.

If the host reports missing MyCode Accessibility or Screen Recording permissions, report the exact failure and direct the user to the Computer Use settings. Do not claim a successful action without a real tool result. Remote workspaces do not receive local desktop control.
