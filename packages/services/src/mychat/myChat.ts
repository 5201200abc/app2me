import type { Event } from "@mycode/rpc";
import { ServiceChannels } from "@mycode/shared";
import type { MyChatEvent, MyChatRequest, MyChatResult } from "@mycode/shared/mychat";
import { createServiceDescriptor } from "../descriptors.js";
export interface IMyChatService {
  call(request: MyChatRequest): Promise<MyChatResult>;
  readonly onEvent: Event<MyChatEvent>;
}
export const IMyChatService = createServiceDescriptor<IMyChatService>(ServiceChannels.MyChat);
