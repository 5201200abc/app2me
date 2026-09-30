// 扫描仅在 Node 宿主执行，统一使用 provider-node，避免重复实现和误判 Qwen 型号。
export { discoverLocalModels, getDefaultLocalModelsDirectory } from "@mycode/provider-node";
export { isQwen38Model } from "@mycode/provider";
export type { DiscoveredLocalModel, LocalModelScanResult } from "@mycode/provider";
