interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LAST_SELECTED_EDITOR_STORAGE_KEY = "mycode-last-editor-id";
const listeners = new Set<() => void>();

export function subscribeLastSelectedEditorId(listener: () => void): () => void {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LAST_SELECTED_EDITOR_STORAGE_KEY || event.key === null) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", handleStorage);
  };
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastSelectedEditorId(
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  const rawValue = storage?.getItem(LAST_SELECTED_EDITOR_STORAGE_KEY);
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    return null;
  }

  return rawValue;
}

export function persistLastSelectedEditorId(
  editorId: string,
  storage: StorageLike | null = getBrowserStorage(),
) {
  if (!storage || readLastSelectedEditorId(storage) === editorId) return;
  storage.setItem(LAST_SELECTED_EDITOR_STORAGE_KEY, editorId);
  // 旧读取只在挂载时执行；设置改变默认应用后，同窗口打开入口需要立即共享同一持久化值。
  for (const listener of listeners) listener();
}
