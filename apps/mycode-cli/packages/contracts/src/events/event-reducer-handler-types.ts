import type { SessionEvent } from "./session.events.js";
import type { SessionProjection } from "../interfaces/session.port.js";
export type EventHandlerMap = Record<
  string,
  (projection: SessionProjection, event: SessionEvent) => SessionProjection
>;
