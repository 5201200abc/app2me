import { useLayoutEffect, type RefObject } from "react";

/** 只调整底栏 SVG 的可见边界，跳过 Tabler 自带的透明 24px 占位 path。 */
export function useComposerIconBounds(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const fit = () => {
      for (const svg of root.querySelectorAll<SVGSVGElement>("svg")) {
        const boxes = [
          ...svg.querySelectorAll<SVGGraphicsElement>(
            "path:not([stroke='none']),rect,circle,line,polyline,polygon,ellipse",
          ),
        ]
          .map((shape) => shape.getBBox())
          .filter((box) => box.width || box.height);
        if (!boxes.length) continue;
        const x = Math.min(...boxes.map((box) => box.x));
        const y = Math.min(...boxes.map((box) => box.y));
        const right = Math.max(...boxes.map((box) => box.x + box.width));
        const bottom = Math.max(...boxes.map((box) => box.y + box.height));
        svg.setAttribute("viewBox", `${x - 1} ${y - 1} ${right - x + 2} ${bottom - y + 2}`);
      }
    };
    fit();
    const observer = new MutationObserver(fit);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
}
