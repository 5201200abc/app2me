import { useMemo, type ReactNode } from "react";
import { MYCODE_AGENT_PROVIDER, type MyCodeProvider } from "@mycode/shared";
import type { SessionUsageState } from "@mycode/shared/mycode-protocol-v4";
import { ChatContextUsage } from "@/chat-input-toolbar/contextUsage.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";

/** 用量只消费同一 snapshot；位置由底栏拥有，不创建新的用量状态。 */
export function V4ComposerContextUsage({
  usage,
  provider,
  disabled,
  onSendCompressionCommand,
}: {
  usage: SessionUsageState | null;
  provider?: MyCodeProvider;
  disabled: boolean;
  onSendCompressionCommand?: (command: string) => void;
}) {
  const { intl, locale } = useMyCodeIntl();
  const taskUsage = useMemo(() => {
    const contextWindow = usage?.contextWindow;
    if (!contextWindow) return null;
    return {
      used: contextWindow.usedTokens,
      size: contextWindow.maxTokens,
      ...(contextWindow.cache ? { cache: contextWindow.cache } : {}),
      ...(contextWindow.breakdown ? { breakdown: contextWindow.breakdown } : {}),
    };
  }, [usage?.contextWindow]);

  return (
    <ChatContextUsage
      taskUsage={taskUsage}
      selectedProvider={provider ?? MYCODE_AGENT_PROVIDER}
      intl={intl}
      locale={locale}
      onSendCompressionCommand={onSendCompressionCommand}
      compressionDisabled={disabled}
    />
  );
}

export function V4ComposerSubmitControls({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1" data-composer-submit-controls>
      {children}
    </div>
  );
}
