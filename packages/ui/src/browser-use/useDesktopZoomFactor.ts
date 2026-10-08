import { useEffect, useState } from "react";
import { resolveDesktopZoomFactorForLevel } from "@mycode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";

/**
 * 读取当前窗口的 Electron 页面缩放；Web 装配返回 level 0，因此自然回退为 factor 1。
 * 这里复用 IPlatformService，避免共享 UI 直接访问 window.mycode。
 */
export function useDesktopZoomFactor(): number {
  const platform = usePlatform();
  const [zoomLevel, setZoomLevel] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const applyZoomLevel = (nextZoomLevel: number) => {
      if (!cancelled && Number.isFinite(nextZoomLevel)) {
        setZoomLevel(nextZoomLevel);
      }
    };

    void platform.getDesktopZoomLevel?.().then((state) => applyZoomLevel(state.zoomLevel));
    const dispose = platform.onDesktopZoomLevelChanged?.((state) => {
      applyZoomLevel(state.zoomLevel);
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [platform]);

  return resolveDesktopZoomFactorForLevel(zoomLevel);
}
