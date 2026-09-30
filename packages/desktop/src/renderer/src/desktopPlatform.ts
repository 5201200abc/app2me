import { recordArmsCustomEventForE2E } from "@mycode/ui";
import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@mycode/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.mycode.selectDirectory(),
    selectFile: () => window.mycode.selectFile(),
    selectFiles: () => window.mycode.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.mycode.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.mycode.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.mycode.onRemoteSessionClosed(handler),
    onBotRemoteWorkspaceReconnected: (handler) =>
      window.mycode.onBotRemoteWorkspaceReconnected(handler),
    activateOrSetWorkspace: (path) =>
      window.mycode.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.mycode.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.mycode.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.mycode.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.mycode.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.mycode.isDockerAvailable(),
    listWSLDistros: () => window.mycode.listWSLDistros(),
    listDockerContainers: () => window.mycode.listDockerContainers(),
    listSSHConfigAliases: () => window.mycode.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.mycode.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.mycode.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.mycode.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.mycode.openExternal(url),
    openFeedback: () => window.mycode.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.mycode.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.mycode.canOpenCommunity(locale),
    openInFileManager: (path) => window.mycode.openInFileManager(path),
    openExternalFile: (path) => window.mycode.openExternalFile(path),
    openCuaPermissionOnboarding: window.mycode.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.mycode.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.mycode.prepareCuaHelperPermissionDrag
      ? () =>
          window.mycode.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.mycode.startCuaHelperPermissionDrag
      ? () => window.mycode.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.mycode.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.mycode.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.mycode.onPaymentCallback(callback),
    onShareImport: (callback) => window.mycode.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.mycode.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.mycode.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.mycode.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.mycode.getRendererActionTraceConfig
      ? () => window.mycode.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.mycode.onRendererActionTraceConfigChanged
      ? (callback) => window.mycode.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.mycode.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.mycode.reportRendererActionTraceBatch
      ? (batch) => window.mycode.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.mycode.reportRendererHeapSample
      ? (sample) => window.mycode.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.mycode.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.mycode.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.mycode.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.mycode.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.mycode.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) => window.mycode.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.mycode.onFocusTab(handler),
    onNewTab: (handler) => window.mycode.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.mycode.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.mycode.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.mycode.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.mycode.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.mycode.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.mycode.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.mycode.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.mycode.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.mycode.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.mycode.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.mycode.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.mycode.getDesktopWindowChromeState
      ? () => window.mycode.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.mycode.onDesktopWindowChromeStateChanged
      ? (handler) => window.mycode.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.mycode.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.mycode.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.mycode.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.mycode.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.mycode.onTaskNotificationClick(handler),
    exportLogs: () => window.mycode.exportLogs(),
    captureWindowScreenshot: () =>
      window.mycode.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.mycode.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.mycode.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.mycode.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.mycode.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.mycode.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.mycode.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.mycode.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.mycode.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.mycode.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.mycode.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getMyCodeStdioTapDevState: () =>
      window.mycode.getMyCodeStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.mycode.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.mycode.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.mycode.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.mycode.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.mycode.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.mycode.quitAndInstallUpdate(),
    getInstalledEditors: () => window.mycode.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.mycode.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.mycode.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.mycode.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.mycode.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.mycode.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.mycode.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __MYCODE_DEVICE_ID__?: string }).__MYCODE_DEVICE_ID__ ?? "",
  };
}
