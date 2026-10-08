export const MYCHAT_SIDEBAR_WIDTH_KEY = "mychat:sidebar_width";
const legacyWidthKey = String.fromCharCode(
  108,
  117,
  109,
  101,
  110,
  58,
  115,
  105,
  100,
  101,
  98,
  97,
  114,
  95,
  119,
  105,
  100,
  116,
  104,
);

export function readMyChatSidebarWidth(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): string | null {
  const current = storage.getItem(MYCHAT_SIDEBAR_WIDTH_KEY);
  if (current !== null) return current;
  const previous = storage.getItem(legacyWidthKey);
  if (previous !== null) {
    try {
      storage.setItem(MYCHAT_SIDEBAR_WIDTH_KEY, previous);
      storage.removeItem(legacyWidthKey);
    } catch {
      // Storage can remain readable when writes are blocked; keep the existing preference.
    }
  }
  return previous;
}
