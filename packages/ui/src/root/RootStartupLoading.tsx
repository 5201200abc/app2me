import type { ReactNode } from "react";
import brandMark from "@/assets/mycode-mark.png";
import { cn } from "@/components/lib/utils.js";
import "./mycodeStartup.css";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}
export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      className="mycode-startup"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <div className="mycode-startup__sky" aria-hidden="true" />
      <div className="mycode-startup__stars" aria-hidden="true" />
      <div className="mycode-startup__terrain" aria-hidden="true" />
      <div className="mycode-startup__halo" aria-hidden="true" />
      <div className="mycode-startup__emblem" aria-hidden="true">
        <img src={brandMark} alt="" />
      </div>
      {children ? <div className="mycode-startup__content">{children}</div> : null}
    </div>
  );
}
/** 引导与启动页共用同一品牌源图，透明边缘不受主题底色影响。 */
export function MyCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <img
      src={brandMark}
      alt=""
      aria-hidden="true"
      className={cn("mycode-startup-badge", animated && "mycode-startup-badge--animated")}
    />
  );
}
