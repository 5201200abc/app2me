import type { MyCodeSessionFile, MyCodeTaskMeta } from "@mycode/shared";
import { mycodeSessionFileSchema, mycodeTaskMetaSchema, mycodeTaskModeSchema } from "@mycode/shared";

export type LegacyTaskSessionFile = Omit<MyCodeSessionFile, "meta"> & {
  meta: Omit<MyCodeTaskMeta, "mode"> & { mode?: MyCodeTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = mycodeSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: mycodeTaskMetaSchema.extend({
    mode: mycodeTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
