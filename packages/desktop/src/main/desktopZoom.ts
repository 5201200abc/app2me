// Main 旧入口保留兼容，规则唯一归 shared；UI 不再复制另一套范围。
export {
  DESKTOP_ZOOM_MIN_LEVEL,
  DESKTOP_ZOOM_MAX_LEVEL,
  DESKTOP_ZOOM_FACTOR_STEP,
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "@mycode/shared";
