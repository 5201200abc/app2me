// MyCode 与 MyChat 复用桌面侧栏布局尺寸及既有 MyCode 保存宽度规则。
export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX = 240;
export const WORKSPACE_SIDEBAR_MIN_WIDTH_PX = 240;
export const WORKSPACE_SIDEBAR_MAX_WIDTH_RATIO = 0.5;
export const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = "mycode:workspace-shell:sidebar-width-px";

export function clampWorkspaceSidebarWidth(widthPx: number, containerWidthPx?: number) {
  const maxWidthPx =
    containerWidthPx && containerWidthPx > 0
      ? Math.max(
          WORKSPACE_SIDEBAR_MIN_WIDTH_PX,
          containerWidthPx * WORKSPACE_SIDEBAR_MAX_WIDTH_RATIO,
        )
      : Number.POSITIVE_INFINITY;

  return Math.round(Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH_PX, Math.min(widthPx, maxWidthPx)));
}

export function readStoredWorkspaceSidebarWidthPx(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    // 旧默认宽度也曾持久化；只迁移默认值，保留用户手动调整的其他宽度。
    const parsed = Number(raw) === 264 ? WORKSPACE_SIDEBAR_DEFAULT_WIDTH_PX : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? clampWorkspaceSidebarWidth(parsed) : null;
  } catch {
    return null;
  }
}
