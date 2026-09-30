/**
 * BrowserControlPort —— agent 侧浏览器控制端口。
 *
 * browser-client 库把 agent.browsers.* 的每个调用构造成 BrowserCommand，经此端口执行；
 * 实现（ProtocolBrowserControlBroker）把它翻译成 MyCode Protocol 的
 * interaction/browserExecute 反向请求，由 app（host→main WebContentsView/CDP）执行。
 *
 * 类型说明：BrowserCommand/BrowserCommandResult 与 @mycode/shared 的 browser-use 契约同构。
 * 此处定义结构镜像（不 import @mycode/shared，避免 agent contracts 的 zod v3 与 shared zod v4
 * 跨包耦合）；协议边界用 shared 的 zod schema 做运行时校验，两侧一致性由 round-trip 测保证。
 */

/** Playwright 是 Tab API 层，不是 backend family。 */
export type BrowserBackendType = "iab" | "extension" | "cdp";

export interface BrowserCapabilityDescriptor {
  id: string;
  description: string;
}

/**
 * 完成握手且真实可达的 backend descriptor；id 是运行时 connection identity，不能用 type 代替。
 */
export interface BrowserBackendDescriptor {
  id: string;
  generation: number;
  type: BrowserBackendType;
  name: string;
  capabilities: {
    browser?: BrowserCapabilityDescriptor[];
    tab?: BrowserCapabilityDescriptor[];
  };
  apiSupportOverrides?: Record<string, boolean>;
  metadata?: Record<string, string>;
}

/** MyCode Protocol 使用包装结果；BrowserControlPort.list 会解包并直接返回 browsers。 */
export interface BrowserBackendListResult {
  browsers: BrowserBackendDescriptor[];
}

export type BrowserClientMode = "desktop-continuous" | "web-remote-replayable";

export type BrowserSessionContextKind = "live" | "cached";

/** 与 Desktop 自由尺寸视口保持同一组 CSS px 边界。 */
export const BROWSER_VIEWPORT_LIMITS = {
  minWidth: 320,
  maxWidth: 3840,
  minHeight: 320,
  maxHeight: 2160,
} as const;

export interface BrowserViewportSize {
  width: number;
  height: number;
}

/** backend discovery 使用的完整 workspace/session 隔离上下文。 */
export interface BrowserDiscoveryContext {
  requestId: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
  turnId?: string;
  clientMode: BrowserClientMode;
  sessionContext: BrowserSessionContextKind;
}

/** execute 比 discovery 多一个精确 runtime browser identity。 */
export interface BrowserSessionContext extends BrowserDiscoveryContext {
  browserId: string;
  browserGeneration: number;
}

export type BrowserCommandMethod =
  | "navigate"
  | "back"
  | "forward"
  | "reload"
  | "snapshot"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "cuaKeypress"
  | "scroll"
  | "cuaScroll"
  | "domCuaScroll"
  | "hover"
  | "select"
  | "check"
  | "drag"
  | "cuaDrag"
  | "screenshot"
  | "getState"
  | "elementInfo"
  | "evaluate"
  | "getDialog"
  | "handleDialog"
  | "waitFor"
  | "playwright"
  | "playwrightWaitForTimeout"
  | "capabilities"
  | "browserVisibilityGet"
  | "browserVisibilitySet"
  | "browserViewportSet"
  | "browserViewportReset"
  | "recordingStart"
  | "recordingStatus"
  | "recordingCancel"
  | "activateTab"
  | "newTab"
  | "finalize"
  | "finalizeTabs"
  | "listUserTabs"
  | "claimTab"
  | "markDeliverable"
  | "markHandoff"
  | "nameSession"
  | "turnEnded"
  | "closeSession"
  | "cancelRequest"
  | "close"
  | "list";

export type BrowserMouseButton = "left" | "right" | "middle";

export type BrowserKeyModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

export type BrowserPlaywrightModifier = BrowserKeyModifier;

export type BrowserPlaywrightLocatorOperation =
  | "allTextContents"
  | "click"
  | "count"
  | "dblclick"
  | "downloadMedia"
  | "evaluate"
  | "fill"
  | "getAttribute"
  | "innerText"
  | "isEnabled"
  | "isVisible"
  | "press"
  | "selectOption"
  | "setChecked"
  | "textContent"
  | "waitFor";

export type BrowserPlaywrightAction =
  | { name: "domSnapshot" }
  | { name: "elementInfo"; x: number; y: number; includeNonInteractable?: boolean }
  | { name: "elementScreenshot"; x: number; y: number; includeNonInteractable?: boolean }
  | {
      name: "evaluate";
      expression: string;
      expressionKind: "string" | "function";
      arg?: unknown;
      timeoutMs?: number;
    }
  | {
      name: "waitForLoadState";
      state?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    }
  | {
      name: "waitForURL";
      url: string;
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
      timeoutMs?: number;
    }
  | { name: "waitForEvent"; event: "download" | "filechooser"; timeoutMs?: number }
  | { name: "downloadPath"; downloadId: string; timeoutMs?: number }
  | {
      name: "fileChooserSetFiles";
      fileChooserId: string;
      files: string[];
      timeoutMs?: number;
    }
  | {
      name: "locator";
      selector: string;
      operation: BrowserPlaywrightLocatorOperation;
      value?: unknown;
      arg?: unknown;
      expression?: string;
      expressionKind?: "string" | "function";
      attribute?: string;
      checked?: boolean;
      replace?: boolean;
      force?: boolean;
      button?: BrowserMouseButton;
      modifiers?: BrowserPlaywrightModifier[];
      state?: "attached" | "detached" | "visible" | "hidden";
      selections?: Array<{ value?: string; label?: string; index?: number }>;
      timeoutMs?: number;
    };

export interface BrowserPoint {
  x: number;
  y: number;
}

export type BrowserRecordingAction =
  | { type: "wait"; durationMs: number }
  | {
      type: "click";
      selector?: string;
      x?: number;
      y?: number;
      button?: BrowserMouseButton;
      doubleClick?: boolean;
      delayAfterMs?: number;
    }
  | { type: "type"; selector: string; text: string; delayAfterMs?: number }
  | {
      type: "hover";
      selector?: string;
      x?: number;
      y?: number;
      durationMs?: number;
      delayAfterMs?: number;
    }
  | { type: "move"; x: number; y: number; durationMs?: number; delayAfterMs?: number }
  | {
      type: "scroll";
      deltaX?: number;
      deltaY: number;
      durationMs?: number;
      delayAfterMs?: number;
    }
  | {
      type: "scrollTo";
      selector?: string;
      x?: number;
      y?: number;
      durationMs?: number;
      delayAfterMs?: number;
    }
  | {
      type: "wheel";
      deltaX?: number;
      deltaY: number;
      times?: number;
      intervalMs?: number;
      delayAfterMs?: number;
    }
  | { type: "drag"; path: BrowserPoint[]; durationMs?: number; delayAfterMs?: number }
  | {
      type: "waitFor";
      selector: string;
      state?: "attached" | "detached" | "visible" | "hidden";
      timeoutMs?: number;
      delayAfterMs?: number;
    };

export interface BrowserRecordingOptions {
  viewport?: BrowserViewportSize;
  fps?: number;
  jpegQuality?: number;
  maxDurationMs?: number;
  settleMs?: number;
  showCursor?: boolean;
  actions?: BrowserRecordingAction[];
}
