export interface HelloMessage {
  type: "mycode-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "mycode-hello-ack";
  version: string;
  clientId: string;
}
