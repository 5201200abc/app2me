import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

/** 仅展示欢迎内容；文案、Logo 与会话事实由调用方提供。 */
export function ConversationEmptyStatePresentation({
  brand,
  greeting,
  className,
  greetingTestId,
}: {
  brand: ReactNode;
  greeting: ReactNode;
  className?: string;
  greetingTestId?: string;
}) {
  return (
    <div
      className={cn(
        "relative mb-7 flex w-full max-w-[680px] flex-col items-center justify-center gap-4",
        className,
      )}
    >
      {brand}
      <p
        data-v4-draft-greeting={greetingTestId === "v4-draft-greeting" ? "true" : undefined}
        data-testid={greetingTestId}
        className="draft-welcome-title w-full px-4 text-center text-ui-xl font-semibold leading-snug text-foreground-subtle"
      >
        {greeting}
      </p>
    </div>
  );
}
