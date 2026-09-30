import type { CuaDriverOperation, CuaDriverResult } from "@mycode/shared";

interface DriverConnection {
  generation: string;
  mcp: { command: string; args: string[]; environment: { name: string; value: string }[] };
}

export interface NativeCuaDriverHost {
  start(): Promise<DriverConnection>;
  restart(): Promise<DriverConnection>;
  stop(): Promise<void>;
  uniffiDestroy(): void;
}

export function createCuaDriverHost(deps: {
  loadDriver(): Promise<NativeCuaDriverHost>;
  permissions(
    request: boolean,
  ):
    | { accessibility: boolean; screenRecording: boolean }
    | Promise<{ accessibility: boolean; screenRecording: boolean }>;
  grantOwner: string;
}) {
  let owner: Promise<NativeCuaDriverHost> | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const assertActive = () => {
    if (disposed) throw new Error("Cua Driver host disposed");
  };
  return {
    async execute(operation: CuaDriverOperation): Promise<CuaDriverResult> {
      assertActive();
      const permissions = await deps.permissions(operation === "connect");
      assertActive();
      if (operation === "status") {
        return { kind: "status", grantOwner: deps.grantOwner, ...permissions };
      }
      if (!permissions.accessibility || !permissions.screenRecording) {
        throw new Error(
          "Cua Driver requires MyCode Accessibility and Screen Recording permissions",
        );
      }
      // 原占位 Helper 不会执行桌面操作；按上游嵌入契约只让 Main 持有真实 driver，避免权限归属到 Host。
      owner ??= deps.loadDriver().catch((error) => {
        owner = undefined;
        throw error;
      });
      const driver = await owner;
      assertActive();
      const connection = await (operation === "restart" ? driver.restart() : driver.start());
      assertActive();
      if (operation === "restart") return { kind: "restarted" };
      return {
        kind: "connection",
        generation: connection.generation,
        command: connection.mcp.command,
        args: connection.mcp.args,
        env: Object.fromEntries(connection.mcp.environment.map(({ name, value }) => [name, value])),
      };
    },
    dispose(): Promise<void> {
      disposed = true;
      disposal ??= (async () => {
        const driver = await owner?.catch(() => undefined);
        if (!driver) return;
        try {
          await driver.stop();
        } finally {
          driver.uniffiDestroy();
        }
      })();
      return disposal;
    },
  };
}
