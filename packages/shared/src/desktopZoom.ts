/** Electron 窗口、菜单与内置浏览器坐标统一使用实际大小上下各两级。 */
export const DESKTOP_ZOOM_MIN_LEVEL = -2;
export const DESKTOP_ZOOM_MAX_LEVEL = 2;
export const DESKTOP_ZOOM_FACTOR_STEP = 1.1;

export function clampDesktopZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(DESKTOP_ZOOM_MAX_LEVEL, Math.max(DESKTOP_ZOOM_MIN_LEVEL, Math.round(level)));
}

export function resolveDesktopZoomFactorForLevel(level: number): number {
  return Math.pow(DESKTOP_ZOOM_FACTOR_STEP, clampDesktopZoomLevel(level));
}

export function resolveDesktopZoomLevelFromFactor(zoomFactor: number): number {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return 0;
  return clampDesktopZoomLevel(
    Math.round(Math.log(zoomFactor) / Math.log(DESKTOP_ZOOM_FACTOR_STEP)),
  );
}
