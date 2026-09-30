import type { TraceContext } from "../tracing/tracer.js";
import {
  type BrowserMouseButton,
  type BrowserKeyModifier,
  type BrowserPoint,
  type BrowserPlaywrightAction,
  type BrowserRecordingOptions,
  type BrowserBackendDescriptor,
} from "./browser-control.port-browser-backend-type.js";
import {
  type BrowserControlListInput,
  type BrowserCommandResult,
} from "./browser-control.port-browser-error-code.js";

// tabId（可选）：agent 对象模型用于寻址指定受控 tab（含 human 开的 tab）；缺省作用于会话默认 view。
// 与 @mycode/shared 的 browserCommandSchema 各变体结构镜像同步。
export type BrowserCommand =
  | { method: "navigate"; url: string; tabId?: string }
  | { method: "back"; tabId?: string }
  | { method: "forward"; tabId?: string }
  | { method: "reload"; tabId?: string }
  | { method: "snapshot"; maxElements?: number; includeHidden?: boolean; tabId?: string }
  | {
      method: "click";
      ref?: string;
      x?: number;
      y?: number;
      button?: BrowserMouseButton;
      doubleClick?: boolean;
      modifiers?: BrowserKeyModifier[];
      tabId?: string;
    }
  | { method: "fill"; ref: string; value: string; tabId?: string }
  | { method: "type"; ref?: string; text: string; tabId?: string }
  | { method: "press"; key: string; ref?: string; modifiers?: BrowserKeyModifier[]; tabId?: string }
  | { method: "cuaKeypress"; keys: string[]; tabId?: string }
  | { method: "scroll"; ref?: string; x?: number; y?: number; tabId?: string }
  | {
      method: "cuaScroll";
      x: number;
      y: number;
      scrollX: number;
      scrollY: number;
      modifiers?: BrowserKeyModifier[];
      tabId?: string;
    }
  | { method: "domCuaScroll"; nodeId?: string; scrollX: number; scrollY: number; tabId?: string }
  | {
      method: "hover";
      ref?: string;
      x?: number;
      y?: number;
      modifiers?: BrowserKeyModifier[];
      tabId?: string;
    }
  | { method: "select"; ref: string; values: string[]; tabId?: string }
  | { method: "check"; ref: string; checked?: boolean; tabId?: string }
  | {
      method: "drag";
      fromRef?: string;
      toRef?: string;
      from?: BrowserPoint;
      to?: BrowserPoint;
      modifiers?: BrowserKeyModifier[];
      tabId?: string;
    }
  | {
      method: "cuaDrag";
      path: BrowserPoint[];
      modifiers?: BrowserKeyModifier[];
      tabId?: string;
    }
  | {
      method: "screenshot";
      ref?: string;
      fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      tabId?: string;
    }
  | { method: "getState"; tabId?: string }
  | { method: "elementInfo"; x: number; y: number; tabId?: string }
  | { method: "evaluate"; expression: string; tabId?: string }
  | { method: "getDialog"; tabId?: string }
  | { method: "handleDialog"; accept: boolean; promptText?: string; tabId?: string }
  | {
      method: "waitFor";
      selector?: string;
      text?: string;
      textGone?: string;
      timeoutMs?: number;
      tabId?: string;
    }
  | { method: "playwrightWaitForTimeout"; timeoutMs: number; tabId?: string }
  | { method: "playwright"; action: BrowserPlaywrightAction; tabId?: string }
  | { method: "capabilities"; tabId?: string }
  | { method: "browserVisibilityGet" }
  | { method: "browserVisibilitySet"; visible: boolean }
  | { method: "browserViewportSet"; width: number; height: number; tabId?: string }
  | { method: "browserViewportReset"; tabId?: string }
  | { method: "recordingStart"; options?: BrowserRecordingOptions; tabId?: string }
  | {
      method: "recordingStatus";
      recordingId: string;
      outputPath?: string;
      tabId?: string;
    }
  | { method: "recordingCancel"; recordingId: string; tabId?: string }
  | { method: "activateTab"; tabId: string }
  | { method: "newTab" }
  | { method: "listUserTabs" }
  | { method: "claimTab"; tabId: string }
  | {
      method: "finalizeTabs";
      keep: Array<{ tabId: string; status: "handoff" | "deliverable" }>;
    }
  | { method: "markDeliverable"; tabId: string }
  | { method: "markHandoff"; tabId: string }
  | { method: "nameSession"; name: string }
  | { method: "finalize"; tabId?: string; deliverable?: boolean }
  | { method: "turnEnded"; turnId?: string }
  | { method: "closeSession" }
  | { method: "cancelRequest"; requestId: string }
  // close：关闭指定受控 tab；manager 层处理。
  | { method: "close"; tabId?: string }
  // list：枚举当前会话窗口下所有受控 tab 摘要，manager 层拦截处理，返回 tabs。
  | { method: "list" };

export interface BrowserControlExecuteInput {
  /** 精确 runtime backend id；不能只传 iab/extension/cdp family。 */
  browserId: string;
  browserGeneration: number;
  sessionId: string;
  turnId?: string;
  command: BrowserCommand;
  traceContext?: TraceContext;
  signal?: AbortSignal;
}

export interface BrowserControlPort {
  /** 只返回完成握手且当前 context 可达的 backend，不允许伪造 stub。 */
  list(input: BrowserControlListInput): Promise<BrowserBackendDescriptor[]>;
  execute(input: BrowserControlExecuteInput): Promise<BrowserCommandResult>;
  /** turn 结束时取消该 turn 尚未完成的 IAB 请求，不跨 session 清 tab。 */
  turnEnded?(input: BrowserControlListInput): Promise<void>;
  /** session 关闭时释放 browser guest、pending request 与 lease。 */
  closeSession?(input: BrowserControlListInput): Promise<void>;
}

export type { BrowserBackendType } from "./browser-control.port-browser-backend-type.js";
export type { BrowserCapabilityDescriptor } from "./browser-control.port-browser-backend-type.js";
export type { BrowserBackendDescriptor } from "./browser-control.port-browser-backend-type.js";
export type { BrowserBackendListResult } from "./browser-control.port-browser-backend-type.js";
export type { BrowserClientMode } from "./browser-control.port-browser-backend-type.js";
export type { BrowserSessionContextKind } from "./browser-control.port-browser-backend-type.js";
export { BROWSER_VIEWPORT_LIMITS } from "./browser-control.port-browser-backend-type.js";
export type { BrowserViewportSize } from "./browser-control.port-browser-backend-type.js";
export type { BrowserDiscoveryContext } from "./browser-control.port-browser-backend-type.js";
export type { BrowserSessionContext } from "./browser-control.port-browser-backend-type.js";
export type { BrowserCommandMethod } from "./browser-control.port-browser-backend-type.js";
export type { BrowserMouseButton } from "./browser-control.port-browser-backend-type.js";
export type { BrowserKeyModifier } from "./browser-control.port-browser-backend-type.js";
export type { BrowserPlaywrightModifier } from "./browser-control.port-browser-backend-type.js";
export type { BrowserPlaywrightLocatorOperation } from "./browser-control.port-browser-backend-type.js";
export type { BrowserPlaywrightAction } from "./browser-control.port-browser-backend-type.js";
export type { BrowserPoint } from "./browser-control.port-browser-backend-type.js";
export type { BrowserRecordingAction } from "./browser-control.port-browser-backend-type.js";
export type { BrowserRecordingOptions } from "./browser-control.port-browser-backend-type.js";
export type { BrowserErrorCode } from "./browser-control.port-browser-error-code.js";
export type { BrowserPageState } from "./browser-control.port-browser-error-code.js";
export type { BrowserSnapshotElement } from "./browser-control.port-browser-error-code.js";
export type { BrowserSnapshotDomNode } from "./browser-control.port-browser-error-code.js";
export type { BrowserSnapshot } from "./browser-control.port-browser-error-code.js";
export type { BrowserTabSummary } from "./browser-control.port-browser-error-code.js";
export type { BrowserUserTabInfo } from "./browser-control.port-browser-error-code.js";
export type { BrowserResponseMeta } from "./browser-control.port-browser-error-code.js";
export type { BrowserDialog } from "./browser-control.port-browser-error-code.js";
export type { BrowserRecordingArtifact } from "./browser-control.port-browser-error-code.js";
export type { BrowserRecordingJob } from "./browser-control.port-browser-error-code.js";
export type { BrowserCommandResult } from "./browser-control.port-browser-error-code.js";
export type { BrowserControlListInput } from "./browser-control.port-browser-error-code.js";
