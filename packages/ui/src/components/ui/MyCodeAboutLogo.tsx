import brandMark from "@/assets/mycode-mark.png";
import { cn } from "@/components/lib/utils.js";
export function MyCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={brandMark}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
export function MyCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <span
      aria-label="mycode"
      className={cn("shrink-0 font-semibold tracking-tight text-ui-xl", className)}
    >
      mycode
    </span>
  );
}
