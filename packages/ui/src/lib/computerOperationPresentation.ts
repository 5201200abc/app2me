/** 仅识别计算机操作的展示身份，兼容旧 MCP 和插件服务名，不改协议执行名。 */
export function isComputerOperationService(name: string | null | undefined): boolean {
  return /^(?:.*:)?(?:cua_driver|cua)$/u.test(name ?? "");
}
