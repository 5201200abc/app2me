import { useCallback, useEffect, useRef, useState } from "react";

/** 滚动条只在滚动期间可见；延时仅用于视觉淡出，不参与会话状态同步。 */
export function useScrollActivity() {
  const [scrolling, setScrolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback(() => {
    setScrolling(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setScrolling(false), 500);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { scrolling, onScroll };
}
