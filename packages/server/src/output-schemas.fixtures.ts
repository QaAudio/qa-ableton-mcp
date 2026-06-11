/**
 * Representative kernel payloads for output-schema validation.
 * Field types align with sdk.d.ts; shapes align with serialize.ts.
 */

export const contextConciseFixture = {
  tempo: 120,
  scale: {
    rootNote: 9,
    scaleName: "Minor",
    scaleMode: true,
  },
  grid: { quantization: "Bar", isTriplet: false },
  trackCount: 1,
  sceneCount: 2,
  tracks: [
    {
      addr: { kind: "track" as const, index: 0, name: "Bass" },
      index: 0,
      name: "Bass",
      type: "midi" as const,
      mute: false,
      solo: false,
      arm: true,
      groupTrackIndex: null,
      mixer: { volume: 0.85, panning: 0, sends: [0, null] },
      clipSlots: [
        {
          slot: 0,
          hasClip: true,
          clip: {
            name: "Bassline",
            type: "midi" as const,
            startTime: 0,
            endTime: 16,
            duration: 16,
            looping: true,
            muted: false,
            noteCount: 8,
          },
        },
        { slot: 1, hasClip: false, clip: null },
      ],
      arrangementClipCount: 0,
      clipPlacement: {
        sessionFilledSlots: 1,
        sessionNoteCount: 8,
        arrangementClipCount: 0,
        status: "session_only" as const,
      },
      devices: [
        {
          index: 0,
          name: "Analog",
          type: "Device" as const,
          paramCount: 64,
          addr: { kind: "device" as const, track: 0, index: 0 },
        },
      ],
    },
  ],
  scenes: [
    {
      addr: { kind: "scene" as const, index: 0 },
      index: 0,
      name: "Intro",
      tempo: 120,
      signature: "4/4",
    },
  ],
  cuePoints: [
    {
      addr: { kind: "cuePoint" as const, index: 0 },
      index: 0,
      name: "Drop",
      time: 32,
    },
  ],
  returnTracks: [
    {
      addr: { kind: "returnTrack" as const, index: 0 },
      name: "A-Reverb",
      mute: false,
      solo: false,
      mixer: { volume: 0.8, panning: 0, sends: [] },
      deviceNames: ["Reverb"],
    },
  ],
  mainTrack: {
    addr: { kind: "mainTrack" as const },
    name: "Main",
    mute: false,
    solo: false,
    mixer: { volume: 1, panning: 0, sends: [] },
    deviceNames: ["Utility"],
  },
};

export const contextDetailedFixture = {
  ...contextConciseFixture,
  scale: {
    ...contextConciseFixture.scale,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10],
  },
  tracks: [
    {
      ...contextConciseFixture.tracks[0],
      mutedViaSolo: false,
      clipSlots: [
        {
          slot: 0,
          hasClip: true,
          clip: {
            name: "Bassline",
            type: "midi" as const,
            startTime: 0,
            endTime: 16,
            duration: 16,
            looping: true,
            muted: false,
            loopStart: 0,
            loopEnd: 16,
            color: 3,
            noteCount: 8,
          },
        },
      ],
    },
  ],
};

export const trackDetailedFixture = {
  ...contextDetailedFixture.tracks[0],
  arrangementClipCount: 0,
  sessionClips: [
    {
      slot: 0,
      clip: {
        name: "Bassline",
        type: "midi" as const,
        startTime: 0,
        endTime: 16,
        duration: 16,
        looping: true,
        muted: false,
        loopStart: 0,
        loopEnd: 16,
        color: 3,
        noteCount: 2,
        notes: [
          { pitch: 36, startTime: 0, duration: 1, velocity: 100 },
          { pitch: 36, startTime: 2, duration: 1 },
        ],
      },
    },
  ],
  arrangementClips: [],
  devices: [
    {
      addr: { kind: "device" as const, track: 0, index: 0 },
      name: "Reverb",
      type: "Device" as const,
      parameters: [
        {
          name: "Device On",
          min: 0,
          max: 1,
          isQuantized: true,
          value: 1,
          defaultValue: 1,
          valueItems: [{ name: "Off", shortName: "Off" }, { name: "On", shortName: "On" }],
        },
      ],
    },
  ],
  takeLanes: [
    {
      index: 0,
      name: "Take 1",
      clips: [
        {
          name: "Take Clip",
          type: "midi" as const,
          startTime: 0,
          endTime: 4,
          duration: 4,
          looping: false,
          muted: false,
          notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 90 }],
        },
      ],
    },
  ],
};

export const trackConciseTruncatedFixture = {
  ...trackDetailedFixture,
  arrangementClips: Array.from({ length: 32 }, (_, i) => ({
    index: i,
    clip: {
      name: `Clip ${i}`,
      type: "midi" as const,
      startTime: i * 4,
      endTime: (i + 1) * 4,
      duration: 4,
      looping: false,
      muted: false,
      noteCount: 0,
    },
  })),
  arrangementTruncated: true,
  totalArrangementClips: 40,
  takeLanes: undefined,
};

export const deviceRackFixture = {
  addr: { kind: "device" as const, track: 0, index: 0 },
  name: "Drum Rack",
  type: "DrumRack" as const,
  parameters: [{ name: "Macro 1", min: 0, max: 127, isQuantized: false, value: 64 }],
  chains: [
    {
      index: 0,
      mixer: { volume: 1, panning: 0, sends: [0] },
      receivingNote: 36,
      devices: [
        {
          addr: { kind: "device" as const, track: 0, index: 0, chain: [0, 0] },
          name: "Simpler",
          type: "Simpler" as const,
          parameters: [{ name: "Gain", min: 0, max: 1, isQuantized: false, value: 0.5 }],
        },
      ],
    },
  ],
};

export const clipMidiConciseTruncatedFixture = {
  name: "Big Clip",
  type: "midi" as const,
  startTime: 0,
  endTime: 64,
  duration: 64,
  looping: true,
  muted: false,
  noteCount: 200,
  notes: Array.from({ length: 128 }, (_, i) => ({
    pitch: 60 + (i % 12),
    startTime: i * 0.25,
    duration: 0.25,
    velocity: 100,
  })),
  notesTruncated: true,
  totalNoteCount: 200,
};

export const clipAudioDetailedFixture = {
  name: "Vocal",
  type: "audio" as const,
  startTime: 0,
  endTime: 16,
  duration: 16,
  looping: false,
  muted: false,
  loopStart: 0,
  loopEnd: 16,
  color: 5,
  warping: true,
  warpMode: "Complex",
  filePath: "C:/Samples/vocal.wav",
  warpMarkers: [{ sampleTime: 0, beatTime: 0 }, { sampleTime: 44100, beatTime: 1 }],
};

export const selectionFixture = {
  selection: {
    scope: "arrangementSelection",
    capturedAt: 1717000000000,
    addresses: [
      { kind: "track" as const, index: 0, name: "Bass" },
      { kind: "clipSlot" as const, track: 1, slot: 0 },
      { kind: "device" as const, track: 0, index: 1, chain: [0, 1] },
      {
        kind: "mixerParam" as const,
        trackKind: "track" as const,
        trackIndex: 0,
        which: "send" as const,
        sendIndex: 0,
      },
    ],
    timeSelection: { start: 0, end: 16 },
  },
};

export const renderAudioFixture = {
  wavPath: "C:/Users/me/AppData/Local/Temp/qa-render-abc123.wav",
};

export const findClipFixture = {
  addr: { kind: "arrangementClip" as const, track: 2, index: 1 },
  view: "arrangement" as const,
  clip: {
    name: "Breakdown Drums",
    type: "midi" as const,
    startTime: 32,
    endTime: 48,
    duration: 16,
    looping: false,
    muted: false,
    noteCount: 24,
  },
  noteCount: 24,
  pitchSummary: { pitches: [36, 38, 42, 54], counts: { "36": 8, "38": 4, "42": 4, "54": 8 } },
};

export const drumRackMapFixture = {
  addr: { kind: "device" as const, track: 2, index: 0 },
  name: "808 Core Kit",
  type: "DrumRack" as const,
  pads: [
    {
      chainIndex: 0,
      receivingNote: 36,
      devices: [{ name: "Kick", type: "Simpler" as const }],
      sampleLabel: "808 Kick.wav",
    },
    {
      chainIndex: 1,
      receivingNote: 48,
      devices: [{ name: "Shaker", type: "Simpler" as const }],
      sampleLabel: "Shaker.wav",
    },
  ],
};

export const remapClipNotesFixture = {
  scope: "clip" as const,
  clips: [
    {
      addr: { kind: "arrangementClip" as const, track: 2, index: 1 },
      name: "Breakdown Drums",
      notesRemapped: 8,
      pitchSummary: { pitches: [36, 38, 42, 48], counts: { "36": 8, "38": 4, "42": 4, "48": 8 } },
    },
  ],
  totalNotesRemapped: 8,
  unmappedPitchesUsed: [36, 38, 42],
};
