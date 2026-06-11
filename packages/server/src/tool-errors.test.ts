import { test } from "node:test";
import assert from "node:assert/strict";
import { steerKernelError, steerInputValidationError, steerOutputSchemaMismatch } from "./tool-errors.js";

test("steerKernelError: transpile phase suggests SDK knowledge lookups", () => {
  const out = steerKernelError("Unexpected token", "transpile");
  assert.match(out, /search_knowledge/);
  assert.match(out, /cheatsheet/);
  assert.match(out, /no import statements/);
});

test("steerKernelError: timeout phase suggests batching", () => {
  const out = steerKernelError("exceeded 30000ms", "timeout");
  assert.match(out, /ui\.progress/);
  assert.match(out, /timeoutMs/);
});

test("steerKernelError: bad address hints valid addr shapes", () => {
  const out = steerKernelError("get_device requires a device address");
  assert.match(out, /kind:'device'/);
  assert.match(out, /ableton_scan_context/);
});

test("steerKernelError: truncation suggests concise and narrowing", () => {
  const out = steerKernelError("[truncated]", undefined, { truncated: true });
  assert.match(out, /responseFormat:'concise'/);
  assert.match(out, /includeDevices:false/);
  assert.match(out, /read_clip_notes/);
});

test("steerOutputSchemaMismatch: suggests recovery path", () => {
  const out = steerOutputSchemaMismatch("  - clip.color: expected number");
  assert.match(out, /includeDevices:false/);
  assert.match(out, /read_clip_notes/);
});

test("steerKernelError: non-MIDI track suggests run_code createMidiTrack", () => {
  const out = steerKernelError('Track 2 ("Drums") is not a MIDI track');
  assert.match(out, /createMidiTrack/);
  assert.match(out, /search_knowledge/);
});

test("steerKernelError: empty slot suggests run_code clip creation", () => {
  const out = steerKernelError("No clip in slot track 0 slot 1 — create a clip via run_code first");
  assert.match(out, /createMidiClip/);
});

test("steerInputValidationError: missing addr hints device shape", () => {
  const out = steerInputValidationError(
    "ableton_read_drum_rack_map",
    'path ["addr"] — expected object, received undefined',
  );
  assert.match(out, /kind:'device'/);
  assert.match(out, /retry this tool/);
  assert.match(out, /not track:N/);
});

test("steerInputValidationError: generic reminds run_code for mutations", () => {
  const out = steerInputValidationError("ableton_scan_track", "invalid type at index");
  assert.match(out, /fix arguments, and retry/);
  assert.match(out, /run_code/);
});
