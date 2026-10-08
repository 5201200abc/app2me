import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  attachDesktopWindowSizePersistence,
  resolveDesktopWindowSize,
} from "./desktopWindowSize.js";

test("first launch defaults, legacy sizes and relocated displays", () => {
  assert.deepEqual(resolveDesktopWindowSize(undefined, { x: 0, y: 25, width: 1440, height: 850 }), {
    width: 1080,
    height: 720,
    maximized: false,
  });
  assert.deepEqual(
    resolveDesktopWindowSize(
      { width: 500, height: 640, maximized: false },
      { x: 0, y: 0, width: 1440, height: 900 },
    ),
    { width: 760, height: 640, maximized: false },
  );
  assert.deepEqual(
    resolveDesktopWindowSize(
      { x: -1300, y: 70, width: 980, height: 650, maximized: true },
      { x: -1440, y: 25, width: 1440, height: 850 },
    ),
    { x: -1300, y: 70, width: 980, height: 650, maximized: true },
  );
  assert.deepEqual(
    resolveDesktopWindowSize(
      { x: 2400, y: -1000, width: 2000, height: 1000, maximized: false },
      { x: 0, y: 25, width: 1440, height: 850 },
    ),
    { x: 0, y: 25, width: 1440, height: 850, maximized: false },
  );
});

test("close captures the latest move/resize and quit waits for pending saves without later writes", async () => {
  const events = new EventEmitter();
  let bounds = { x: 40, y: 60, width: 1080, height: 720 };
  const saved: unknown[] = [];
  const resolvers: Array<() => void> = [];
  const controller = attachDesktopWindowSizePersistence(
    {
      on: events.on.bind(events),
      isDestroyed: () => false,
      isMaximized: () => true,
      getNormalBounds: () => bounds,
    },
    async (state) => {
      saved.push(state);
      await new Promise<void>((resolve) => resolvers.push(resolve));
    },
  );
  events.emit("move");
  events.emit("resize");
  bounds = { x: -960, y: 50, width: 900, height: 600 };
  events.emit("close");
  assert.deepEqual(saved[0], { ...bounds, maximized: true });
  let finished = false;
  const flush = controller.flushForQuit().then(() => {
    finished = true;
  });
  events.emit("resize");
  events.emit("move");
  events.emit("close");
  events.emit("maximize");
  assert.equal(saved.length, 2);
  await Promise.resolve();
  assert.equal(finished, false);
  resolvers.forEach((resolve) => resolve());
  await flush;
  assert.equal(finished, true);
  events.emit("closed");
});
