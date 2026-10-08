import assert from "node:assert/strict";
import test from "node:test";
import type { IBroadcastService } from "@mycode/services";
import { createMyCodeStore } from "../src/store/index.js";

test("MyChat 模式持久化，并清理办公模式而不广播客户端模式", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        classList: { toggle() {} },
        hasAttribute: () => false,
        style: { setProperty() {} },
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  const sent: unknown[] = [];
  const broadcast = {
    send: (message: unknown) => sent.push(message),
    onMessage: () => () => {},
  } as unknown as IBroadcastService;
  try {
    const initial = createMyCodeStore(broadcast);
    assert.equal(initial.getState().interfaceMode, "mycode");
    initial.getState().setInterfaceMode("mychat");
    assert.equal(storage.getItem("mycode-interface-mode"), "mychat");
    assert.equal(createMyCodeStore(broadcast).getState().interfaceMode, "mychat");
    assert.deepEqual(sent, []);
    storage.setItem("mycode-interface-mode", "office");
    assert.equal(createMyCodeStore(broadcast).getState().interfaceMode, "mycode");
    assert.equal(storage.getItem("mycode-interface-mode"), null);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
