import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@mycode/rpc";
import {
  IMyCodeTaskService,
  type IMyCodeTaskService as IMyCodeTaskServiceShape,
} from "#src/session/mycodeTaskService.js";
import {
  IMyCodeAgentService,
  type IMyCodeAgentService as IMyCodeAgentServiceShape,
} from "#src/mycode-agent/mycodeAgent.js";
import {
  IMyCodeSessionService,
  type IMyCodeSessionService as IMyCodeSessionServiceShape,
} from "#src/mycode-session/mycodeSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  mycodeAgentService: IMyCodeAgentServiceShape;
  mycodeTaskService: IMyCodeTaskServiceShape;
  mycodeSessionService: IMyCodeSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    mycodeAgentService: ProxyChannel.toService<IMyCodeAgentServiceShape>(
      client.getChannel(IMyCodeAgentService.channelName),
    ),
    mycodeTaskService: ProxyChannel.toService<IMyCodeTaskServiceShape>(
      client.getChannel(IMyCodeTaskService.channelName),
    ),
    mycodeSessionService: ProxyChannel.toService<IMyCodeSessionServiceShape>(
      client.getChannel(IMyCodeSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
