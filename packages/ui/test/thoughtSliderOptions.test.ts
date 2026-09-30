import assert from "node:assert/strict";
import test from "node:test";
import { localModelReasoning } from "@mycode/provider";
import { resolveThoughtSlider } from "../src/chat-input-toolbar/thoughtSliderOptions.js";

test("Qwen slider has exactly three official stops, with off independent and reset xhigh", () => {
  const options = localModelReasoning("Qwen3.8-27B").values.map((value) => ({
    value,
    label: value,
  }));
  for (const [index, value] of ["low", "medium", "xhigh"].entries()) {
    const state = resolveThoughtSlider({ options, currentValue: value });
    assert.deepEqual(
      state.levels.map((entry) => entry.value),
      ["low", "medium", "xhigh"],
    );
    assert.equal(state.selectedIndex, index);
    assert.equal(state.defaultValue, "xhigh");
    assert.equal(state.off?.value, "disabled");
  }
  assert.equal(resolveThoughtSlider({ options, currentValue: "disabled" }).enabled, false);
  assert.equal(resolveThoughtSlider({ options, currentValue: "high" }).selectedIndex, -1);
});

test("other local models have only thinking/no thinking", () => {
  const options = localModelReasoning("Qwen3.5-27B").values.map((value) => ({
    value,
    label: value,
  }));
  const state = resolveThoughtSlider({ options, currentValue: "enabled" });
  assert.equal(state.isToggle, true);
  assert.deepEqual(
    state.levels.map((entry) => entry.value),
    ["enabled"],
  );
  assert.equal(state.off?.value, "disabled");
});
