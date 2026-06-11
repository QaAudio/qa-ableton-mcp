import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceClipColor } from "./serialize/index.js";

test("coerceClipColor: number passthrough", () => {
  assert.equal(coerceClipColor(3), 3);
  assert.equal(coerceClipColor(0), 0);
});

test("coerceClipColor: numeric string from Live", () => {
  assert.equal(coerceClipColor("14"), 14);
});

test("coerceClipColor: invalid values omitted", () => {
  assert.equal(coerceClipColor("red"), undefined);
  assert.equal(coerceClipColor(undefined), undefined);
  assert.equal(coerceClipColor(NaN), undefined);
});
