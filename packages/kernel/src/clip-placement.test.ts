import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPerceiveHints, clipPlacementFromSlots, isArrangementHeavySet } from "./clip-placement.js";

test("clipPlacementFromSlots: session_only", () => {
  const p = clipPlacementFromSlots(
    [
      { hasClip: true, clip: { noteCount: 12 } },
      { hasClip: false, clip: null },
    ],
    0,
  );
  assert.equal(p.status, "session_only");
  assert.equal(p.sessionFilledSlots, 1);
  assert.equal(p.sessionNoteCount, 12);
});

test("clipPlacementFromSlots: arrangement_only", () => {
  const p = clipPlacementFromSlots([{ hasClip: false, clip: null }], 7);
  assert.equal(p.status, "arrangement_only");
});

test("buildPerceiveHints: warns on session-only track in arrangement-heavy set", () => {
  const tracks = [
    {
      name: "Kick",
      index: 0,
      type: "midi",
      clipPlacement: clipPlacementFromSlots([], 7),
    },
    {
      name: "Chords",
      index: 1,
      type: "midi",
      clipPlacement: clipPlacementFromSlots([], 7),
    },
    {
      name: "pads",
      index: 4,
      type: "midi",
      clipPlacement: clipPlacementFromSlots(
        [{ hasClip: true, clip: { noteCount: 12 } }, { hasClip: true, clip: { noteCount: 24 } }],
        0,
      ),
    },
  ];
  assert.equal(isArrangementHeavySet(tracks), true);
  const hints = buildPerceiveHints(tracks);
  assert.equal(hints.length, 1);
  assert.match(hints[0]!, /pads/);
  assert.match(hints[0]!, /run_code/);
});
