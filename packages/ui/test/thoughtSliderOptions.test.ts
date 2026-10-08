import assert from "node:assert/strict";
import test from "node:test";
import { localModelReasoning } from "@mycode/provider";
import { resolveThoughtSlider } from "../src/chat-input-toolbar/thoughtSliderOptions.js";

test("DeepSeek reset and re-enable use official high while preserving an explicit low", () => {
  const options = ["disabled", "low", "high", "max"].map((value) => ({ value, name: value }));
  const state = resolveThoughtSlider({ options, currentValue: "low", defaultValue: "high" });
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.defaultValue, "high");
  assert.deepEqual(
    state.levels.map((level) => level.value),
    ["low", "high", "max"],
  );
  assert.equal(
    resolveThoughtSlider({ options, currentValue: "disabled", defaultValue: "high" }).defaultValue,
    "high",
  );
});

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

test("strength colors follow level semantics even when a provider omits intermediate levels", () => {
  const options = ["disabled", "low", "medium", "high", "xhigh", "max"].map((value) => ({
    value,
    name: value,
  }));
  for (const [value, color] of Object.entries({
    low: "#9CA3AF",
    medium: "#3B82F6",
    high: "#EAB308",
    xhigh: "#F97316",
    max: "#DC2626",
  })) {
    assert.equal(resolveThoughtSlider({ options, currentValue: value }).color, color);
  }
  for (const value of ["xhigh", "extra-high", "extra_high"]) {
    assert.equal(
      resolveThoughtSlider({ options: [{ value: "low" }, { value }], currentValue: value }).color,
      "#F97316",
    );
  }
  assert.equal(resolveThoughtSlider({ options, currentValue: "disabled" }).color, "#9CA3AF");
  assert.equal(
    resolveThoughtSlider({ options: [{ value: "custom" }], currentValue: "custom" }).color,
    "var(--color-reasoning-accent)",
  );
});
