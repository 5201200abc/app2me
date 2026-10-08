import { useEffect, useState } from "react";
import type { EditorInfo } from "@mycode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

export function useInstalledEditors(): EditorInfo[] {
  const platform = usePlatform();
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  useEffect(() => {
    let disposed = false;
    void platform
      .getInstalledEditors()
      .then((installed) => {
        if (!disposed) setEditors(installed);
      })
      .catch((error) => {
        logger.warn("[useInstalledEditors] 获取已安装应用失败", error);
      });
    return () => {
      disposed = true;
    };
  }, [platform]);
  return editors;
}
