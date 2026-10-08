export function readApplicationListSummary(
  value: unknown,
): { total: number; running: number } | null {
  if (typeof value !== "string") return null;
  const match = /Found\s+(\d+)\s+app\(s\):\s+(\d+)\s+running\b/i.exec(value);
  if (!match) return null;
  const total = Number(match[1]);
  const running = Number(match[2]);
  return Number.isSafeInteger(total) && Number.isSafeInteger(running) && running <= total
    ? { total, running }
    : null;
}
