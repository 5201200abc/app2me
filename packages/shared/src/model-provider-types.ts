/** 原账号提供商已移除；空集合仅保留旧协议的类型出口。 */
export const BUILTIN_PROVIDER_TEMPLATE_IDS = {} as const;
export const BUILTIN_MODEL_PROVIDER_IDS = {} as const;
export type BuiltinOAuthProviderId = never;
export type BuiltinModelProviderId = string;
export function isBuiltinModelProviderId(_id: string): _id is BuiltinModelProviderId {
  return false;
}
export function isStartPlanModelProviderId(_id: string): boolean {
  return false;
}
export function isIndividualCodingPlanModelProviderId(_id: string): boolean {
  return false;
}
export function isCodingPlanModelProviderId(_id: string): boolean {
  return false;
}

export type ModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly error: {
        readonly message: string;
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: "provider-unavailable" | "model-unavailable";
      };
    };
