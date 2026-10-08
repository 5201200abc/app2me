import { useSyncExternalStore } from "react";
import { readLastSelectedEditorId, subscribeLastSelectedEditorId } from "@/lib/editorPreference.js";

const getSnapshot = () => readLastSelectedEditorId();
const getServerSnapshot = () => null;

export function usePreferredEditorId(): string | null {
  return useSyncExternalStore(subscribeLastSelectedEditorId, getSnapshot, getServerSnapshot);
}
