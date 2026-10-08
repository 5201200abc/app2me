import assert from "node:assert/strict";
import test from "node:test";
import {
  persistLastSelectedEditorId,
  readLastSelectedEditorId,
  subscribeLastSelectedEditorId,
} from "../src/lib/editorPreference.js";

test("默认应用共享一个持久化值，显式选择通知订阅者，取消订阅后不再通知", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  let changes = 0;
  const unsubscribe = subscribeLastSelectedEditorId(() => changes++);
  assert.equal(readLastSelectedEditorId(storage), null);
  persistLastSelectedEditorId("finder", storage);
  assert.equal(readLastSelectedEditorId(storage), "finder");
  persistLastSelectedEditorId("finder", storage);
  assert.equal(changes, 1);
  persistLastSelectedEditorId("sublime", storage);
  assert.equal(readLastSelectedEditorId(storage), "sublime");
  assert.equal(changes, 2);
  unsubscribe();
  persistLastSelectedEditorId("terminal", storage);
  assert.equal(changes, 2);
});
