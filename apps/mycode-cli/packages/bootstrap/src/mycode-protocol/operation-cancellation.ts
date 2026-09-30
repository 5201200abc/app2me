import {
  mycodePluginsCancelOperationParamsSchema,
  mycodeWorkspaceCancelGenerateTextParamsSchema,
} from "@mycode/shared";

import type { MyCodeProtocolRequest } from "@mycode/shared";

import { ProtocolRequestError, parseParams } from "./server-types.js";

import {
  getPluginOperationId,
  getOperationId,
} from "./server-max-client-request-reannounce-interval-ms.js";
/** Unique operation ownership and identity-checked release for cancellable requests. */
export class ProtocolOperationCancellation {
  private readonly pluginOperationControllers = new Map<string, AbortController>();
  private readonly workspaceGenerateTextControllers = new Map<string, AbortController>();
  abortAll(error: Error): void {
    for (const controller of this.pluginOperationControllers.values()) controller.abort(error);
    for (const controller of this.workspaceGenerateTextControllers.values())
      controller.abort(error);
  }
  async withPluginOperationSignal<T>(
    request: MyCodeProtocolRequest,
    run: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operationId = getPluginOperationId(request.params);
    if (!operationId) return await run();

    const controller = new AbortController();
    this.pluginOperationControllers.set(operationId, controller);
    try {
      return await run(controller.signal);
    } finally {
      if (this.pluginOperationControllers.get(operationId) === controller) {
        this.pluginOperationControllers.delete(operationId);
      }
    }
  }
  cancelPluginOperation(rawParams: unknown) {
    const params = parseParams(mycodePluginsCancelOperationParamsSchema, rawParams);
    const controller = this.pluginOperationControllers.get(params.operationId);
    if (!controller) return { operationId: params.operationId, cancelled: false };
    // 插件同步的可取消能力必须保留在 V4 server；仅按 operationId 中止对应链路。
    controller.abort();
    this.pluginOperationControllers.delete(params.operationId);
    return { operationId: params.operationId, cancelled: true };
  }
  async withWorkspaceGenerateTextSignal<T>(
    request: MyCodeProtocolRequest,
    run: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operationId = getOperationId(request.params);
    if (!operationId) return await run();

    if (this.workspaceGenerateTextControllers.has(operationId)) {
      // 重复 operationId 会覆盖首个请求的 AbortController，导致首个请求失去取消能力。
      // 活跃 operationId 必须保持唯一；请求结束后 finally 会释放，之后才允许复用。
      throw new ProtocolRequestError(
        -32600,
        `Workspace generate operation is already active: ${operationId}`,
      );
    }

    const controller = new AbortController();
    this.workspaceGenerateTextControllers.set(operationId, controller);
    try {
      return await run(controller.signal);
    } finally {
      if (this.workspaceGenerateTextControllers.get(operationId) === controller) {
        this.workspaceGenerateTextControllers.delete(operationId);
      }
    }
  }
  cancelWorkspaceGenerateText(rawParams: unknown) {
    const params = parseParams(mycodeWorkspaceCancelGenerateTextParamsSchema, rawParams);
    const controller = this.workspaceGenerateTextControllers.get(params.operationId);
    if (!controller) return { operationId: params.operationId, cancelled: false };
    controller.abort(new DOMException("Workspace model request cancelled", "AbortError"));
    this.workspaceGenerateTextControllers.delete(params.operationId);
    return { operationId: params.operationId, cancelled: true };
  }
}
