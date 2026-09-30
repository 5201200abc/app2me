import type {
  PermissionRequestedPayload,
  PermissionResolvedPayload,
  PermissionDeniedPayload,
} from "./session.events.js";

import { SessionEventType as EventTypes } from "./session.events.js";

import type { ActiveToolCall, PendingPermission } from "../interfaces/session.port.js";

import type { EventHandlerMap } from "./event-reducer-handler-types.js";

export const permissionEventHandlers: EventHandlerMap = {
  [EventTypes.PermissionRequested]: (p, e) => {
    const payload = e.payload as PermissionRequestedPayload;
    const newPending: PendingPermission = {
      input: payload.input,
      reason: payload.reason,
      requestId: payload.requestId,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      ...(payload.suggestedPermissionUpdates
        ? { suggestedPermissionUpdates: payload.suggestedPermissionUpdates }
        : {}),
      ...(payload.origin ? { origin: payload.origin } : {}),
      ...(payload.display ? { display: payload.display } : {}),
      ...(payload.optionsPolicy ? { optionsPolicy: payload.optionsPolicy } : {}),
      riskLevel: payload.riskLevel,
      requestedAt: e.timestamp,
    };
    return {
      ...p,
      pendingPermissions: [...p.pendingPermissions, newPending],
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.PermissionResolved]: (p, e) => {
    const payload = e.payload as PermissionResolvedPayload;
    let toolStatus: ActiveToolCall["status"] = "completed";
    if (payload.decision === "deny") {
      toolStatus = "denied";
    }

    return {
      ...p,
      pendingPermissions: p.pendingPermissions.filter((pp) => pp.toolCallId !== payload.toolCallId),
      activeToolCalls: p.activeToolCalls.map((tc) =>
        tc.toolCallId === payload.toolCallId ? { ...tc, status: toolStatus } : tc,
      ),
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.PermissionDenied]: (p, e) => {
    const payload = e.payload as PermissionDeniedPayload;
    return {
      ...p,
      pendingPermissions: p.pendingPermissions.filter((pp) => pp.toolCallId !== payload.toolCallId),
      activeToolCalls: p.activeToolCalls.map((tc) =>
        tc.toolCallId === payload.toolCallId ? { ...tc, status: "denied" } : tc,
      ),
      updatedAt: e.timestamp,
    };
  },
};
