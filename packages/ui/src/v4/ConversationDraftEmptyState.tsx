/** 草稿首页保留时间问候，用紧凑文字与单色线稿呈现。 */
import { useEffect, useState } from "react";
import { Terminal } from "@/components/icons/tabler.js";
import { ConversationEmptyStatePresentation } from "@/v4/ConversationEmptyStatePresentation.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";

const GREETING_BOUNDARY_HOURS = [5, 9, 12, 14, 18, 23] as const;

type ChatEmptyGreetingMessageId =
  | "chat.empty.greeting.morningEarly"
  | "chat.empty.greeting.morning"
  | "chat.empty.greeting.noon"
  | "chat.empty.greeting.afternoon"
  | "chat.empty.greeting.evening"
  | "chat.empty.greeting.lateNight";

function getChatEmptyGreetingMessageId(date: Date = new Date()): ChatEmptyGreetingMessageId {
  const hour = date.getHours();

  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "chat.empty.greeting.morning";
  if (hour >= 12 && hour < 14) return "chat.empty.greeting.noon";
  if (hour >= 14 && hour < 18) return "chat.empty.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "chat.empty.greeting.evening";

  return "chat.empty.greeting.lateNight";
}

function getNextChatEmptyGreetingDelayMs(date: Date = new Date()) {
  const candidates = GREETING_BOUNDARY_HOURS.map((hour) => {
    const boundary = new Date(date);
    boundary.setHours(hour, 0, 0, 0);
    return boundary;
  });
  const tomorrowFirstBoundary = new Date(date);
  tomorrowFirstBoundary.setDate(tomorrowFirstBoundary.getDate() + 1);
  tomorrowFirstBoundary.setHours(GREETING_BOUNDARY_HOURS[0], 0, 0, 0);

  const nextBoundary =
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ?? tomorrowFirstBoundary;

  return Math.max(1, nextBoundary.getTime() - date.getTime());
}

export function ConversationDraftEmptyState({ className }: { className?: string }) {
  const { intl } = useMyCodeIntl();
  const [greetingDate, setGreetingDate] = useState(() => new Date());
  const greeting = intl.formatMessage({
    id: getChatEmptyGreetingMessageId(greetingDate),
  });

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setGreetingDate(new Date()),
      getNextChatEmptyGreetingDelayMs(greetingDate),
    );
    return () => window.clearTimeout(timeout);
  }, [greetingDate]);

  return (
    <ConversationEmptyStatePresentation
      className={className}
      greeting={greeting}
      greetingTestId="v4-draft-greeting"
      brand={
        <Terminal
          aria-hidden="true"
          data-testid="v4-draft-brand"
          size={48}
          className="pointer-events-none size-12 shrink-0 text-foreground-subtle opacity-45"
        />
      }
    />
  );
}
