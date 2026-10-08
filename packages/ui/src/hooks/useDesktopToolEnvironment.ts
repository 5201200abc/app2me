import { useEffect, useState } from "react";
import type { DesktopToolEnvironment } from "@mycode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";

export function useDesktopToolEnvironment(enabled: boolean) {
  const platform = useOptionalPlatform();
  const [environment, setEnvironment] = useState<DesktopToolEnvironment | null>(null);
  useEffect(() => {
    setEnvironment(null);
    if (!enabled || !platform?.getDesktopToolEnvironment) return;
    let disposed = false;
    void platform
      .getDesktopToolEnvironment()
      .then((result) => {
        if (!disposed) setEnvironment(result);
      })
      .catch(() => {
        /* 环境信息缺席不伪造已加载，也不标为任务错误。 */
      });
    return () => {
      disposed = true;
    };
  }, [enabled, platform]);
  return environment;
}
