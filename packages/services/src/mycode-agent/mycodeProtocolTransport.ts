import type { Event, IDisposable } from "@mycode/rpc";
import type { MyCodeProtocolMessage } from "@mycode/shared";

export type MyCodeProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface MyCodeProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface MyCodeProtocolTransport extends IDisposable {
  readonly kind: MyCodeProtocolTransportKind;
  readonly onMessage: Event<MyCodeProtocolMessage>;
  readonly onClose: Event<MyCodeProtocolTransportClosedEvent>;
  send(message: MyCodeProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
