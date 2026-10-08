import type { OAuthProviderId } from "@mycode/shared";
import { LogInIcon } from "@/components/icons/tabler.js";
import { cn } from "@/components/lib/utils.js";

export function renderOAuthProviderIcon(_provider: OAuthProviderId, className?: string) {
  return <LogInIcon className={cn("shrink-0", className)} />;
}
