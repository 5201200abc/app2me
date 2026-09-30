import { useMyCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useMyCodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}
