import { z } from "zod";

/**
 * MyCode agent 提供方的单一真源。
 *
 * 类型 MyCodeProvider、运行时 schema mycodeProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / mycode-protocol 等无环引用。
 */
const MYCODE_PROVIDERS = ["glm"] as const;

export const mycodeProviderSchema = z.enum(MYCODE_PROVIDERS);

export type MyCodeProvider = (typeof MYCODE_PROVIDERS)[number];
