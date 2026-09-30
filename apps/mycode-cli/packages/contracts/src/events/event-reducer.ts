import { sessionEventHandlers } from "./event-reducer-session-handlers.js";
import { targetEventHandlers } from "./event-reducer-target-handlers.js";
import { queueEventHandlers } from "./event-reducer-queue-handlers.js";
import { toolEventHandlers } from "./event-reducer-tool-handlers.js";
import { permissionEventHandlers } from "./event-reducer-permission-handlers.js";
// ============================================================
// Event Reducer - State projection from events
// ============================================================

import type { SessionEvent } from "./session.events.js";

import type { SessionProjection } from "../interfaces/session.port.js";
import { initialSessionProjection } from "./event-reducer-helpers.js";

// -----------------------------------------------
// Event Reducer
// -----------------------------------------------

export class EventReducer {
  reduce(events: SessionEvent[]): SessionProjection {
    return events.reduce((projection, event) => this.apply(projection, event), {
      ...initialSessionProjection,
      id: events[0]?.sessionId ?? ("unknown" as any),
    } as SessionProjection);
  }

  apply(projection: SessionProjection, event: SessionEvent): SessionProjection {
    const handler = this.handlers[event.type];
    if (handler) {
      return handler(projection, event);
    }
    return {
      ...projection,
      updatedAt: event.timestamp,
    };
  }

  private handlers: Record<
    string,
    (projection: SessionProjection, event: SessionEvent) => SessionProjection
  > = {
    ...sessionEventHandlers,
    ...targetEventHandlers,
    ...queueEventHandlers,
    ...toolEventHandlers,
    ...permissionEventHandlers,
  };
}

// -----------------------------------------------
// Utility Functions
// -----------------------------------------------

export function reduce(events: SessionEvent[]): SessionProjection {
  return new EventReducer().reduce(events);
}

export function apply(projection: SessionProjection, event: SessionEvent): SessionProjection {
  return new EventReducer().apply(projection, event);
}
