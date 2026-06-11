import { z } from "zod";
import { AddressSchema } from "@quantumaudio/ableton-mcp-schemas";

export { AddressSchema };

const nonNegInt = z.number().int().nonnegative();

// ---- tool input shapes (ZodRawShape — passed to registerTool.inputSchema) ----

export const runCodeShape = {
  code: z
    .string()
    .describe(
      "JavaScript/TypeScript to run in the kernel against the live Ableton SDK. Before first use, search_knowledge (qa-knowledge MCP) for the Ableton SDK quickstart and recipes. In scope: `context`, `song`, `ableton`, `ir` (parseNotation/parseDrumGrid/parsePianoRoll + to* encoders), `log()`, `console`, `withinTransaction(fn)`, `sleep(ms)`, `signal`, `ui`. NO import statements. Look up the SDK API with search_knowledge.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .describe("Wall-clock timeout for awaited work (default 30000). Note: synchronous infinite loops are NOT interruptible."),
};

export const responseFormatShape = {
  responseFormat: z
    .enum(["concise", "detailed"])
    .optional()
    .describe(
      "Detail level (default concise). concise drops low-signal fields and caps list lengths; detailed keeps full ids/fields for follow-up run_code.",
    ),
};

export const representationsShape = {
  representations: z
    .array(z.enum(["notation", "drumGrid", "harmony", "pianoRoll", "structure"]))
    .optional()
    .describe(
      "Optional intermediate representations (text) alongside SDK JSON. notation/drumGrid/harmony/pianoRoll for clip note reads; structure for scan_context/scan_track. Multiple values allowed. See repr-* skills in knowledge base.",
    ),
};

export const getContextShape = {
  includeReturns: z.boolean().optional().describe("Include return tracks (default true)."),
  includeMain: z.boolean().optional().describe("Include the main track (default true)."),
  includeDevices: z.boolean().optional().describe("Include per-track device metadata (default true). Set false to shrink large Sets."),
  ...responseFormatShape,
  ...representationsShape,
};

export const addrShape = { addr: AddressSchema };

/** scan_track — no includePitchSummary (use read_clip_notes / find_clip for pitch histograms). */
export const getTrackShape = {
  ...addrShape,
  ...responseFormatShape,
  ...representationsShape,
  includeDevices: z
    .boolean()
    .optional()
    .describe(
      "Include full device trees with parameter values (default true). Set false on rack-heavy tracks to avoid huge payloads.",
    ),
};

export const readAddrShape = {
  ...addrShape,
  ...responseFormatShape,
  ...representationsShape,
  includePitchSummary: z
    .boolean()
    .optional()
    .describe("MIDI clips only: include pitchSummary { pitches, counts } alongside notes."),
};

export const renderAudioShape = {
  addr: AddressSchema.describe("An audio track address ({kind:'track', index}) whose pre-FX audio to render."),
  startBeat: z.number().describe("Start position in beats."),
  endBeat: z.number().describe("End position in beats."),
};

const clipWriteAddrSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clipSlot"), track: nonNegInt, slot: nonNegInt }),
  z.object({ kind: z.literal("arrangementClip"), track: nonNegInt, index: nonNegInt }),
]);

const pitchMapEntrySchema = z.object({
  from: z.number().int().min(0).max(127).describe("Source MIDI pitch to replace."),
  to: z.number().int().min(0).max(127).describe("Target MIDI pitch."),
});

export const findClipShape = {
  track: nonNegInt.describe("Regular MIDI track index from ableton_scan_context."),
  name: z.string().describe("Exact clip name to find."),
  view: z
    .enum(["session", "arrangement", "both"])
    .optional()
    .describe("Search session slots, arrangement clips, or both (default both)."),
  includePitchSummary: z
    .boolean()
    .optional()
    .describe("Include unique pitches and per-pitch note counts."),
  ...representationsShape,
};

export const getDrumRackMapShape = {
  addr: z
    .object({
      kind: z.literal("device"),
      track: nonNegInt,
      index: nonNegInt,
      chain: z.array(z.number().int()).optional(),
    })
    .describe(
      "Drum Rack **device** addr from scan_context tracks[].devices[] where type is DrumRack — " +
        "not a bare track index. Example: {\"kind\":\"device\",\"track\":1,\"index\":0}.",
    ),
};

export const remapClipNotesShape = {
  scope: z
    .enum(["clip", "trackArrangement"])
    .describe("clip = one clip; trackArrangement = all arrangement MIDI clips on track."),
  addr: clipWriteAddrSchema.optional().describe("Required for scope clip unless track+clipName is used."),
  track: nonNegInt.optional().describe("Required for trackArrangement; also used with clipName."),
  clipName: z.string().optional().describe("Alternative to addr when scope is clip."),
  pitchMap: z
    .array(pitchMapEntrySchema)
    .min(1)
    .describe("Pitch replacements, e.g. GM shaker 54 → 808 shaker 48."),
};
