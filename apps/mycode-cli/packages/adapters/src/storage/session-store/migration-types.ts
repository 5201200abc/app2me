export interface SqliteMigration {
  appVersion: string;
  id: string;
  sql: string;
  /** 仅接受已发布退役迁移的精确摘要，不放宽其他版本的校验。 */
  retiredChecksum?: string;
}
