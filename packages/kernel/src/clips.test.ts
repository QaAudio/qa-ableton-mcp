import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePitchMap, remapNotes, buildPitchSummary, uniquePitches } from "./clips.js";

test("parsePitchMap: valid entries", () => {
  const map = parsePitchMap([
    { from: 54, to: 48 },
    { from: 36, to: 36 },
  ]);
  assert.equal(map.get(54), 48);
  assert.equal(map.get(36), 36);
});

test("parsePitchMap: rejects duplicate from", () => {
  assert.throws(() => parsePitchMap([{ from: 36, to: 48 }, { from: 36, to: 50 }]), /duplicate from/);
});

test("remapNotes: counts remapped pitches", () => {
  const map = parsePitchMap([{ from: 54, to: 48 }]);
  const { notes, remapped } = remapNotes(
    [
      { pitch: 54, startTime: 0, duration: 1 },
      { pitch: 36, startTime: 1, duration: 1 },
    ],
    map,
  );
  assert.equal(remapped, 1);
  assert.equal(notes[0]!.pitch, 48);
  assert.equal(notes[1]!.pitch, 36);
});

test("buildPitchSummary and uniquePitches", () => {
  const notes = [
    { pitch: 36, startTime: 0, duration: 1 },
    { pitch: 54, startTime: 1, duration: 1 },
    { pitch: 36, startTime: 2, duration: 1 },
  ];
  assert.deepEqual(uniquePitches(notes), [36, 54]);
  assert.deepEqual(buildPitchSummary(notes), {
    pitches: [36, 54],
    counts: { "36": 2, "54": 1 },
  });
});
