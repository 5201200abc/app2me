// 旧账号及内置别名不再迁移为可执行连接；保留用户现有 Provider 的精确身份。
export function migrateLegacyOfficialModelId(_providerId: string, modelId: string): string {
  return modelId;
}
export function migrateLegacyModelProviderId(providerId: string): string | undefined {
  return providerId.startsWith("builtin:") || providerId.startsWith("account:")
    ? undefined
    : providerId;
}
