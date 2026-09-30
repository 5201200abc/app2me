import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalModelScanResult } from "@mycode/provider";
import { useServices } from "./useServices.js";

export function useLocalModels() {
  const { providerSettingsService } = useServices();
  const [scan, setScan] = useState<LocalModelScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await providerSettingsService.getLocalModels();
      if (token === generation.current) setScan(next);
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [providerSettingsService]);
  useEffect(() => {
    setScan(null);
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  return { scan, error, loading, reload };
}
