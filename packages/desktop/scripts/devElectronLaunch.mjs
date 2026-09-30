import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENVIRONMENT_ARG = "--mycode-dev-environment=";

export async function createMacDevElectronLaunch({
  appPath,
  entryPath,
  logDirectory,
  env,
  kill = process.kill,
}) {
  const launchId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "mycode-dev-launch-"));
  const environmentPath = join(directory, "environment.json");
  const socketPath = join(directory, "owner.sock");
  let owner;
  let ownerPid;
  let requestedSignal;
  let cleanupPromise;
  const signal = (value) => {
    requestedSignal = value;
    if (!owner || owner.destroyed || !ownerPid) return;
    if (value === "SIGKILL") {
      try {
        kill(ownerPid, value);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        ownerPid = undefined;
      }
    } else owner.write("stop\n");
  };
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    let data = "";
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      if (owner === socket) {
        owner = undefined;
        ownerPid = undefined;
      }
    });
    socket.on("data", (chunk) => {
      if (owner === socket) return;
      data += chunk.toString();
      if (data.length > 4096) return socket.destroy();
      if (!data.includes("\n")) return;
      try {
        const message = JSON.parse(data.slice(0, data.indexOf("\n")));
        if (
          owner ||
          message.launchId !== launchId ||
          !Number.isSafeInteger(message.pid) ||
          message.pid <= 0
        )
          return socket.destroy();
        owner = socket;
        ownerPid = message.pid;
        socket.write("ready\n");
        if (requestedSignal) signal(requestedSignal);
      } catch {
        socket.destroy();
      }
    });
  });
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    })());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await mkdir(logDirectory, { recursive: true });
    await writeFile(environmentPath, JSON.stringify({ env, launchId, socketPath }), {
      mode: 0o600,
    });
    const logPath = join(logDirectory, `launch-${launchId}.log`);
    // 开发输出可能含诊断上下文；预建私有文件，避免 LaunchServices 使用默认 0644 权限。
    await writeFile(logPath, "", { mode: 0o600, flag: "wx" });
    return {
      command: "/usr/bin/open",
      args: [
        "-n",
        "-W",
        "-a",
        appPath,
        "--stdout",
        logPath,
        "--stderr",
        logPath,
        "--args",
        entryPath,
        `${ENVIRONMENT_ARG}${environmentPath}`,
      ],
      signal,
      logPath,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function consumeDevLaunchEnvironment(argv) {
  const argument = argv.find((value) => value.startsWith(ENVIRONMENT_ARG));
  if (!argument) throw new Error("MyCode Dev environment file argument is missing");
  const file = argument.slice(ENVIRONMENT_ARG.length);
  let environment;
  try {
    environment = JSON.parse(await readFile(file, "utf8"));
  } finally {
    await rm(file, { force: true });
  }
  if (
    !environment?.env ||
    typeof environment.env !== "object" ||
    Array.isArray(environment.env) ||
    Object.values(environment.env).some((value) => typeof value !== "string") ||
    typeof environment.launchId !== "string" ||
    typeof environment.socketPath !== "string"
  ) {
    throw new Error("MyCode Dev environment must contain only string values");
  }
  return environment;
}

export function connectDevLaunchOwner({ launchId, socketPath }, onStop) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let data = "";
    let ready = false;
    socket.on("error", reject);
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ launchId, pid: process.pid })}\n`),
    );
    socket.on("data", (chunk) => {
      data += chunk.toString();
      for (let end; (end = data.indexOf("\n")) >= 0; ) {
        const message = data.slice(0, end);
        data = data.slice(end + 1);
        if (message === "ready") {
          ready = true;
          resolve(socket);
        } else if (message === "stop") onStop();
      }
    });
    socket.once("close", () => {
      if (!ready) reject(new Error("MyCode Dev launch owner closed before handshake"));
      else onStop();
    });
  });
}
