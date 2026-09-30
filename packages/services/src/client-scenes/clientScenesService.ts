import type { IClientScenesService } from "./clientScenes.js";

export function createClientScenesService(): IClientScenesService {
  return {
    // 官方场景接口已退役。沿用调用方的空目录行为，避免在草稿和自动化页发起旧域名请求。
    list: async () => ({ code: 0, msg: "", data: [] }),
  };
}
