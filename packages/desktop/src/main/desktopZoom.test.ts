import assert from "node:assert/strict";
import test from "node:test";
import {
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "./desktopZoom.js";

test("实际大小上下各两级，历史越界设置裁剪", () => {
  for (const [input, expected] of [
    [-3, -2],
    [-2, -2],
    [0, 0],
    [2, 2],
    [5, 2],
  ]) {
    assert.equal(clampDesktopZoomLevel(input), expected);
  }
  assert.equal(clampDesktopZoomLevel(Number.NaN), 0);
  assert.equal(clampDesktopZoomLevel(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampDesktopZoomLevel(1.6), 2);
  assert.equal(clampDesktopZoomLevel(-1.6), -2);
});

test("菜单和快捷键共享系数，边界重复命令不突破限制", () => {
  for (const direction of [-1, 1]) {
    let level = 0;
    for (let i = 0; i < 6; i++) {
      level = clampDesktopZoomLevel(level + direction);
      assert.equal(level, direction * Math.min(2, i + 1));
      const factor = resolveDesktopZoomFactorForLevel(level);
      assert.equal(resolveDesktopZoomLevelFromFactor(factor), level);
    }
  }
  for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveDesktopZoomLevelFromFactor(factor), 0);
  }
  assert.equal(resolveDesktopZoomFactorForLevel(0), 1);
});
