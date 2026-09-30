import { z } from "zod";

export const cuaDriverOperationSchema = z.enum(["connect", "status", "restart"]);
export type CuaDriverOperation = z.infer<typeof cuaDriverOperationSchema>;

export const cuaDriverResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("connection"),
      generation: z.string().min(1),
      command: z.string().min(1),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      grantOwner: z.string().min(1),
      accessibility: z.boolean(),
      screenRecording: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("restarted") }).strict(),
  z.object({ kind: z.literal("error"), message: z.string().min(1) }).strict(),
]);
export type CuaDriverResult = z.infer<typeof cuaDriverResultSchema>;

export const hostCuaDriverRequestSchema = z
  .object({
    type: z.literal("cua-driver-request"),
    requestId: z.string().min(1),
    operation: cuaDriverOperationSchema,
    workspacePath: z.string().min(1).optional(),
    workspaceIdentity: z.string().min(1).optional(),
    remoteSessionId: z.string().min(1).optional(),
  })
  .strict();

export const hostCuaDriverResultSchema = z
  .object({
    type: z.literal("cua-driver-result"),
    requestId: z.string().min(1),
    result: cuaDriverResultSchema,
  })
  .strict();
