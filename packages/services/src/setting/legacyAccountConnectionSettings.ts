import type { ProviderFamilyDomain } from "@mycode/shared";
import { readFile } from "node:fs/promises";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface LegacyTeamConnection {
  readonly family: ProviderFamilyDomain;
  readonly productId: string;
  readonly projectId: string;
}

/** 退役账号连接不再迁移为可执行连接。 */
export function readIncompleteLegacyTeamConnections(_value: unknown): LegacyTeamConnection[] {
  return [];
}

export async function readLegacyAccountConnectionSettingsFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    return record(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function needsLegacyAccountConnectionMigration(value: unknown): boolean {
  const raw = record(value);
  return (
    !Object.hasOwn(raw, "providerFamilyConnectionSelections") &&
    (Object.hasOwn(raw, "modelProviderFamilySelectedKeys") ||
      Object.hasOwn(raw, "modelProviderFamilyModes"))
  );
}

/** 仅在 settings 文件读取边界导入旧连接；运行时代码不能再解释旧导航 key。 */
export function migrateLegacyAccountConnectionSettings(value: unknown): unknown {
  if (!needsLegacyAccountConnectionMigration(value)) return value;
  const raw = record(value);
  return { ...raw, providerFamilyConnectionSelections: {} };
}

/** 旧字段仅供回滚保留，禁止暴露回 AppSettings 或参与当前运行判断；退役旧版后删除。 */
export function retainLegacyAccountConnectionFields(value: unknown): Record<string, unknown> {
  const raw = record(value);
  return Object.fromEntries(
    ["modelProviderFamilyModes", "modelProviderFamilySelectedKeys"]
      .filter((key) => Object.hasOwn(raw, key))
      .map((key) => [key, raw[key]]),
  );
}
