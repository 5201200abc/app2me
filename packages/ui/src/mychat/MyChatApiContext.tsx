import { createContext, useContext } from "react";
import type { MyChatApi } from "@/hooks/useMyChatApi.js";
export const MyChatApiContext = createContext<MyChatApi | null>(null);
export function useMyChatApiContext(): MyChatApi {
  const api = useContext(MyChatApiContext);
  if (!api) throw new Error("MyChat API provider is required");
  return api;
}
