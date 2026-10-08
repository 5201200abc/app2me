import type { ReactNode } from "react";
import type { UiIconProps } from "@/components/icons/tabler.js";
import { sceneIconRegistry } from "@/components/icons/tablerSceneIcons.js";

interface ClientSceneLucideIconProps extends Omit<UiIconProps, "children"> {
  fallback: ReactNode;
  name?: string;
}

/** 保留已发布的场景名称契约；旧语义名映射为 Tabler，不再加载另一套图形库。 */
export function ClientSceneLucideIcon({
  fallback,
  name,
  ...iconProps
}: ClientSceneLucideIconProps) {
  const normalizedName = name?.trim();
  const Icon = normalizedName ? sceneIconRegistry[normalizedName] : undefined;
  return Icon ? <Icon {...iconProps} data-client-scene-icon={normalizedName} /> : fallback;
}
