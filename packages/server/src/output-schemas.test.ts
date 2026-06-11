import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getContextOutputSchema,
  getTrackOutputSchema,
  getDeviceOutputSchema,
  getClipNotesOutputSchema,
  getSelectionOutputSchema,
  renderAudioOutputSchema,
  findClipOutputSchema,
  getDrumRackMapOutputSchema,
  remapClipNotesOutputSchema,
} from "@quantumaudio/ableton-mcp-schemas";
import {
  contextConciseFixture,
  contextDetailedFixture,
  trackDetailedFixture,
  trackConciseTruncatedFixture,
  deviceRackFixture,
  clipMidiConciseTruncatedFixture,
  clipAudioDetailedFixture,
  selectionFixture,
  renderAudioFixture,
  findClipFixture,
  drumRackMapFixture,
  remapClipNotesFixture,
} from "./output-schemas.fixtures.js";

function assertParses<T extends { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown } } }>(
  schema: T,
  fixture: unknown,
  label: string,
): void {
  const parsed = schema.safeParse(fixture);
  assert.equal(
    parsed.success,
    true,
    `${label}: ${parsed.success ? "" : JSON.stringify(parsed.error?.issues, null, 2)}`,
  );
}

test("getContextOutputSchema: concise kernel payload", () => {
  assertParses(getContextOutputSchema, contextConciseFixture, "context concise");
});

test("getContextOutputSchema: detailed kernel payload", () => {
  assertParses(getContextOutputSchema, contextDetailedFixture, "context detailed");
});

test("getContextOutputSchema: rejects scaleMode as number", () => {
  const bad = {
    ...contextConciseFixture,
    scale: { ...contextConciseFixture.scale, scaleMode: 1 },
  };
  assert.equal(getContextOutputSchema.safeParse(bad).success, false);
});

test("getTrackOutputSchema: detailed track payload", () => {
  assertParses(getTrackOutputSchema, trackDetailedFixture, "track detailed");
});

test("getTrackOutputSchema: concise truncated arrangement", () => {
  assertParses(getTrackOutputSchema, trackConciseTruncatedFixture, "track concise truncated");
});

test("getDeviceOutputSchema: rack with nested chain devices", () => {
  assertParses(getDeviceOutputSchema, deviceRackFixture, "device rack");
});

test("getDeviceOutputSchema: null parameter value (getValue timeout)", () => {
  assertParses(
    getDeviceOutputSchema,
    {
      addr: { kind: "device", track: 0, index: 0 },
      name: "EQ Eight",
      type: "Device",
      parameters: [{ name: "1 Gain A", min: 0, max: 1, isQuantized: false, value: null }],
    },
    "device null param",
  );
});

test("getClipNotesOutputSchema: concise truncated MIDI clip", () => {
  assertParses(getClipNotesOutputSchema, clipMidiConciseTruncatedFixture, "clip midi truncated");
});

test("getClipNotesOutputSchema: detailed audio clip with warp markers", () => {
  assertParses(getClipNotesOutputSchema, clipAudioDetailedFixture, "clip audio detailed");
});

test("getClipNotesOutputSchema: NoteDescription without velocity", () => {
  assertParses(
    getClipNotesOutputSchema,
    {
      name: "Clip",
      type: "midi",
      startTime: 0,
      endTime: 4,
      duration: 4,
      looping: false,
      muted: false,
      notes: [{ pitch: 60, startTime: 0, duration: 1 }],
    },
    "clip no velocity",
  );
});

test("getClipNotesOutputSchema: clip color as number in detailed mode", () => {
  assertParses(
    getClipNotesOutputSchema,
    {
      name: "Clip",
      type: "midi",
      startTime: 0,
      endTime: 4,
      duration: 4,
      looping: true,
      muted: false,
      loopStart: 0,
      loopEnd: 4,
      color: 14,
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 100 }],
    },
    "clip with color",
  );
});

test("getSelectionOutputSchema: full Address union incl. mixerParam", () => {
  assertParses(getSelectionOutputSchema, selectionFixture, "selection");
  assert.equal(getSelectionOutputSchema.safeParse({ selection: null }).success, true);
});

test("renderAudioOutputSchema", () => {
  assertParses(renderAudioOutputSchema, renderAudioFixture, "render audio");
});

test("findClipOutputSchema", () => {
  assertParses(findClipOutputSchema, findClipFixture, "find clip");
});

test("getDrumRackMapOutputSchema", () => {
  assertParses(getDrumRackMapOutputSchema, drumRackMapFixture, "drum rack map");
});

test("remapClipNotesOutputSchema", () => {
  assertParses(remapClipNotesOutputSchema, remapClipNotesFixture, "remap clip notes");
});

test("getClipNotesOutputSchema: pitchSummary extension", () => {
  assertParses(
    getClipNotesOutputSchema,
    {
      ...clipMidiConciseTruncatedFixture,
      pitchSummary: { pitches: [60], counts: { "60": 128 } },
    },
    "clip pitch summary",
  );
});
