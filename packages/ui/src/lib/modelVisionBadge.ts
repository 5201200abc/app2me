import type { ProviderConfigObject } from "@mycode/provider";

/** 视觉徽标只消费模型能力事实，不再为原发行方套餐添加展示例外。 */
export function shouldShowModelVisionBadge(
  _modelId: string,
  supportsImage: boolean | null | undefined,
  _access?: ProviderConfigObject["access"],
): boolean {
  return supportsImage === true;
}
