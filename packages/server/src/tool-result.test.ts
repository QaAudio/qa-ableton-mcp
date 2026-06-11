import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toToolResult } from "./tool-result.js";

const sampleSchema = z.object({
  tempo: z.number(),
  name: z.string(),
});

const resp = (partial: Omit<Parameters<typeof toToolResult>[0], "id">) => ({ id: 1, ...partial });

test("toToolResult: success with matching schema sets structuredContent", () => {
  const out = toToolResult(resp({ ok: true, result: { tempo: 120, name: "Set" } }), sampleSchema);
  assert.equal(out.isError, undefined);
  assert.deepEqual(out.structuredContent, { tempo: 120, name: "Set" });
  assert.match(out.content[0]!.text, /"tempo": 120/);
});

test("toToolResult: schema mismatch omits structuredContent and warns", () => {
  const out = toToolResult(resp({ ok: true, result: { tempo: "fast", name: "Set" } }), sampleSchema);
  assert.equal(out.structuredContent, undefined);
  assert.equal(out.isError, true);
  assert.match(out.content[0]!.text, /\[outputSchema mismatch\]/);
  assert.match(out.content[0]!.text, /Structured output validation failed/);
  assert.match(out.content[0]!.text, /"tempo": "fast"/);
});

test("toToolResult: kernel error unchanged", () => {
  const out = toToolResult(resp({ ok: false, error: "no clip at the given address", phase: "runtime" }));
  assert.equal(out.isError, true);
  assert.match(out.content[0]!.text, /Error \[runtime\]/);
  assert.equal(out.structuredContent, undefined);
});

test("toToolResult: no schema keeps plain structuredContent", () => {
  const out = toToolResult(resp({ ok: true, result: { foo: 1 } }));
  assert.deepEqual(out.structuredContent, { foo: 1 });
});

test("toToolResult: renders representations as fenced text sections", () => {
  const clipSchema = z.object({
    name: z.string(),
    representations: z.object({ notation: z.string() }).optional(),
  });
  const out = toToolResult(
    resp({
      ok: true,
      result: {
        name: "Chords",
        representations: { notation: "bar 1:\n  1:1 C4 q" },
      },
    }),
    clipSchema,
  );
  assert.match(out.content[0]!.text, /intermediate representations/);
  assert.match(out.content[0]!.text, /### notation/);
  assert.match(out.content[0]!.text, /1:1 C4 q/);
  assert.doesNotMatch(out.content[0]!.text, /"notation":/);
});
