import { useCallback } from "react";
import type { ModelSelectionView } from "@mycode/provider";
import type { ModelSelection } from "@mycode/shared";

export function useStartPlanRecommendation(
  _view?: ModelSelectionView | null | undefined,
  _surface?: "subagent",
) {
  return useCallback(
    async (selection: ModelSelection): Promise<ModelSelection | null> => {
      return selection;
    },
    [],
  );
}
