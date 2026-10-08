import type { BrowserWindow, Rectangle } from "electron";
import type { AppSettings } from "@mycode/shared";

export const DEFAULT_DESKTOP_WINDOW_WIDTH = 1080;
export const DEFAULT_DESKTOP_WINDOW_HEIGHT = 720;
export const MIN_DESKTOP_WINDOW_WIDTH = 760;
export const MIN_DESKTOP_WINDOW_HEIGHT = 520;
const WINDOW_SIZE_PERSIST_DEBOUNCE_MS = 250;
export type DesktopWindowSize = NonNullable<AppSettings["desktopWindowSize"]>;

function clampDimension(value: number, minimum: number, available: number): number {
  return Math.min(Math.max(Math.floor(value), minimum), Math.max(minimum, Math.floor(available)));
}

export function resolveDesktopWindowSize(
  persisted: DesktopWindowSize | undefined,
  workArea: Pick<Rectangle, "width" | "height"> & Partial<Pick<Rectangle, "x" | "y">>,
): DesktopWindowSize {
  const width = clampDimension(
    persisted?.width ?? DEFAULT_DESKTOP_WINDOW_WIDTH,
    MIN_DESKTOP_WINDOW_WIDTH,
    workArea.width,
  );
  const height = clampDimension(
    persisted?.height ?? DEFAULT_DESKTOP_WINDOW_HEIGHT,
    MIN_DESKTOP_WINDOW_HEIGHT,
    workArea.height,
  );
  const hasPosition = Number.isFinite(persisted?.x) && Number.isFinite(persisted?.y);
  return {
    width,
    height,
    ...(hasPosition
      ? {
          x: Math.min(
            Math.max(Math.floor(persisted!.x!), workArea.x ?? 0),
            (workArea.x ?? 0) + Math.max(0, workArea.width - width),
          ),
          y: Math.min(
            Math.max(Math.floor(persisted!.y!), workArea.y ?? 0),
            (workArea.y ?? 0) + Math.max(0, workArea.height - height),
          ),
        }
      : {}),
    maximized: persisted?.maximized ?? false,
  };
}

type WindowSizePersistenceTarget = Pick<
  BrowserWindow,
  "getNormalBounds" | "isDestroyed" | "isMaximized"
> & {
  on(
    event: "resize" | "move" | "maximize" | "unmaximize" | "close" | "closed",
    listener: () => void,
  ): unknown;
};
type WindowSizePersistenceController = { flushForQuit: () => Promise<void> };
const windowPersistenceControllers = new Set<WindowSizePersistenceController>();

export async function flushDesktopWindowSizePersistenceForQuit(): Promise<void> {
  await Promise.all(
    [...windowPersistenceControllers].map((controller) => controller.flushForQuit()),
  );
}

export function attachDesktopWindowSizePersistence(
  win: WindowSizePersistenceTarget,
  save: (state: DesktopWindowSize) => Promise<void>,
  onSaveError: (error: unknown) => void = () => undefined,
): WindowSizePersistenceController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frozen = false;
  const pending = new Set<Promise<void>>();
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const capture = () => {
    if (win.isDestroyed()) return;
    // 最大化时保存 normal bounds，避免工作区覆盖用户的普通窗口尺寸和位置。
    const bounds = win.getNormalBounds();
    const write = save({
      x: Math.floor(bounds.x),
      y: Math.floor(bounds.y),
      width: Math.max(MIN_DESKTOP_WINDOW_WIDTH, Math.floor(bounds.width)),
      height: Math.max(MIN_DESKTOP_WINDOW_HEIGHT, Math.floor(bounds.height)),
      maximized: win.isMaximized(),
    }).catch(onSaveError);
    pending.add(write);
    void write.then(() => pending.delete(write));
  };
  const persistImmediately = () => {
    clearTimer();
    if (!frozen) capture();
  };
  const schedule = () => {
    clearTimer();
    if (frozen) return;
    timer = setTimeout(persistImmediately, WINDOW_SIZE_PERSIST_DEBOUNCE_MS);
  };
  const controller: WindowSizePersistenceController = {
    async flushForQuit() {
      // close 曾只取消防抖，丢失最后一次调整。退出开始时捕获并等待原子写完成，
      // 同时冻结后续事件，避免退出屏障结束后新写入遗留 setting.json.lock。
      clearTimer();
      if (!frozen) {
        frozen = true;
        capture();
      }
      await Promise.all([...pending]);
    },
  };
  windowPersistenceControllers.add(controller);
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", persistImmediately);
  win.on("unmaximize", persistImmediately);
  win.on("close", persistImmediately);
  win.on("closed", () => {
    clearTimer();
    frozen = true;
    // 已关闭窗口的在途写入仍纳入退出屏障，完成后再释放注册。
    void Promise.all([...pending]).then(() => windowPersistenceControllers.delete(controller));
  });
  return controller;
}
