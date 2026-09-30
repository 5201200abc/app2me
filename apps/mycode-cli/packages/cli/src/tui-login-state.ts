import type { CommandCenterApp } from "./command-center.js";

/** Registry 已按本地和个人 Provider 可用性过滤模型。 */
export function createTuiModelAvailabilityChecker(
  getApp: () => Promise<CommandCenterApp>,
): () => Promise<boolean> {
  return async () => {
    const app = await getApp();
    return ((await app.listModels?.()) ?? []).some((model) => !model.disabledReason);
  };
}
