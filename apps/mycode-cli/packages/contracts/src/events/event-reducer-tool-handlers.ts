import type {
  ToolCallScheduledPayload,
  ToolCallStartedPayload,
  ToolCallResultPayload,
  ToolCallErrorPayload,
  ToolBatchCompletePayload,
  BackgroundTaskStartedPayload,
  BackgroundTaskUpdatedPayload,
  BackgroundTaskCompletedPayload,
} from "./session.events.js";

import { SessionEventType as EventTypes } from "./session.events.js";

import type { ActiveToolCall } from "../interfaces/session.port.js";
import {
  applyBackgroundTaskCompleted,
  applyBackgroundTaskStarted,
  applyBackgroundTaskUpdated,
} from "./event-reducer-helpers.js";
import type { EventHandlerMap } from "./event-reducer-handler-types.js";

export const toolEventHandlers: EventHandlerMap = {
  [EventTypes.ToolCallScheduled]: (p, e) => {
    const payload = e.payload as ToolCallScheduledPayload;
    const newToolCall: ActiveToolCall = {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      status: "pending",
    };
    return {
      ...p,
      activeToolCalls: [...p.activeToolCalls, newToolCall],
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.ToolCallStarted]: (p, e) => {
    const payload = e.payload as ToolCallStartedPayload;
    return {
      ...p,
      activeToolCalls: p.activeToolCalls.map((tc) =>
        tc.toolCallId === payload.toolCallId
          ? { ...tc, status: "running", startedAt: payload.startedAt }
          : tc,
      ),
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.ToolCallResult]: (p, e) => {
    const payload = e.payload as ToolCallResultPayload;
    return {
      ...p,
      activeToolCalls: p.activeToolCalls.map((tc) =>
        tc.toolCallId === payload.toolCallId
          ? { ...tc, status: payload.result.success ? "completed" : "failed" }
          : tc,
      ),
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.ToolCallError]: (p, e) => {
    const payload = e.payload as ToolCallErrorPayload;
    return {
      ...p,
      activeToolCalls: p.activeToolCalls.map((tc) =>
        tc.toolCallId === payload.toolCallId ? { ...tc, status: "failed" } : tc,
      ),
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.ToolBatchComplete]: (p, e) => {
    const payload = e.payload as ToolBatchCompletePayload;
    const activeToolCalls = p.activeToolCalls.filter(
      (tc) => !payload.toolCallIds.includes(tc.toolCallId as any),
    );
    return {
      ...p,
      activeToolCalls,
      // a tool batch can finish before the turn makes its follow-up model request.
      // Only turn_complete moves the session projection back to idle.
      updatedAt: e.timestamp,
    };
  },
  [EventTypes.BackgroundTaskStarted]: (p, e) => {
    const payload = e.payload as BackgroundTaskStartedPayload;
    return applyBackgroundTaskStarted(p, payload, e.timestamp);
  },
  [EventTypes.BackgroundTaskUpdated]: (p, e) => {
    const payload = e.payload as BackgroundTaskUpdatedPayload;
    return applyBackgroundTaskUpdated(p, payload, e.timestamp);
  },
  [EventTypes.BackgroundTaskCompleted]: (p, e) => {
    const payload = e.payload as BackgroundTaskCompletedPayload;
    return applyBackgroundTaskCompleted(p, payload, e.timestamp);
  },
};
