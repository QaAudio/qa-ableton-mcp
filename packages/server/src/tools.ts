import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runCodeShape,
  getContextShape,
  getTrackShape,
  readAddrShape,
  renderAudioShape,
  findClipShape,
  getDrumRackMapShape,
  remapClipNotesShape,
} from "./schemas.js";
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
import { proxy } from "./proxy.js";

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

type ToolDef = {
  name: string;
  kernelMethod: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  outputSchema?: z.ZodType;
  annotations: ToolAnnotations;
  defaultParams?: unknown;
};

const TOOL_DEFS: ToolDef[] = [
  {
    name: "ableton_run_code",
    kernelMethod: "run_code",
    title: "Execute SDK code in Ableton Live",
    description:
      "Primary mutation path — execute JavaScript/TypeScript against the live Ableton SDK. Use for tracks, MIDI clips/notes, devices, mixer, arrangement edits, import audio, and ui.confirm. `ir.parseNotation` / `ir.parseDrumGrid` / `ir.parsePianoRoll` convert repr-* text to note arrays for clip.notes writes. Before first use, search_knowledge (qa-knowledge MCP) for the Ableton SDK quickstart and recipes. Batch mutations in withinTransaction for one undo step.",
    inputSchema: runCodeShape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ableton_scan_context",
    kernelMethod: "get_context",
    title: "Scan Live Set overview",
    description:
      "Bounded snapshot (always scan first): song meta (tempo, scale, grid), tracks (name, type, mixer, session clipSlots + summaries, clipPlacement, arrangementClipCount, device metadata with addrs), scenes, cue points, return/main, optional perceiveHints. Set representations:['structure'] for a bar-timeline layout. Excludes arrangement timeline clip details (ableton_scan_track), MIDI notes (ableton_read_clip_notes), and per-parameter values (ableton_read_device).",
    inputSchema: getContextShape,
    outputSchema: getContextOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_scan_track",
    kernelMethod: "get_track",
    title: "Scan full track detail",
    description:
      "Deep read for one track: session/arrangement/take-lane clip summaries (or full notes in detailed mode), plus devices. Takes a track addr from ableton_scan_context. Use responseFormat:'detailed' for clip notes; representations:['structure'] for bar-timeline; set includeDevices:false on rack-heavy tracks.",
    inputSchema: getTrackShape,
    outputSchema: getTrackOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_read_device",
    kernelMethod: "get_device",
    title: "Read device parameters",
    description:
      "Full parameter list (current values, ranges, value-item labels) for a device, recursing rack chains. Takes {kind:'device',track,index,chain?}. Use responseFormat:'detailed' for nested rack chains and DrumChain receivingNote.",
    inputSchema: readAddrShape,
    outputSchema: getDeviceOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_read_clip_notes",
    kernelMethod: "get_clip_notes",
    title: "Read clip notes / warp",
    description:
      "MIDI clip: full note list. Audio clip: warp settings and markers. Takes clipSlot or arrangementClip addr. Default responseFormat:'concise' caps notes at 128 — use 'detailed' for all notes. representations:['notation','drumGrid','harmony','pianoRoll'] return LLM-friendly text (see repr-* skills). Set includePitchSummary:true for pitch histograms.",
    inputSchema: readAddrShape,
    outputSchema: getClipNotesOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_read_selection",
    kernelMethod: "get_selection",
    title: "Read captured selection",
    description:
      "Returns the user's last in-Live selection from 'Send to Agent' (addresses + optional time range). Returns {selection:null} if nothing was sent. No on-demand selection query in the SDK.",
    inputSchema: {},
    outputSchema: getSelectionOutputSchema,
    defaultParams: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_find_clip",
    kernelMethod: "find_clip",
    title: "Find MIDI clip by name",
    description:
      "Locate a MIDI clip on a track by exact name (session and/or arrangement). Returns addr, clip summary, noteCount, optional pitchSummary and representations (notation/drumGrid/harmony/pianoRoll). Errors if zero or multiple matches — narrow with view or use a unique name.",
    inputSchema: findClipShape,
    outputSchema: findClipOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_read_drum_rack_map",
    kernelMethod: "get_drum_rack_map",
    title: "Read Drum Rack pad map",
    description:
      'List Drum Rack chains with receivingNote and nested device names. Requires Drum Rack device addr from scan_context — e.g. {"addr":{"kind":"device","track":1,"index":0}}. Use before ableton_remap_clip_notes for GM→kit pitch maps.',
    inputSchema: getDrumRackMapShape,
    outputSchema: getDrumRackMapOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ableton_remap_clip_notes",
    kernelMethod: "remap_clip_notes",
    title: "Remap MIDI clip pitches (batch)",
    description:
      "Specialized batch pitch remap only — create clips and write notes via ableton_run_code. Replace pitches in one clip (scope clip) or all arrangement MIDI on a track (scope trackArrangement). pitchMap [{from,to},…] after ableton_read_drum_rack_map. One undo step.",
    inputSchema: remapClipNotesShape,
    outputSchema: remapClipNotesOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "ableton_render_audio",
    kernelMethod: "render_audio",
    title: "Render track audio (pre-FX)",
    description:
      "Render pre-effects audio of an audio track between two beats to a WAV file. Does not modify the Set.",
    inputSchema: renderAudioShape,
    outputSchema: renderAudioOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

/** Registers all ableton_* MCP tools on the server. */
export function registerTools(server: McpServer): void {
  for (const def of TOOL_DEFS) {
    const config = {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
    };

    server.registerTool(
      def.name,
      config,
      async (args) => proxy(def.kernelMethod, def.defaultParams ?? args, def.outputSchema),
    );
  }
}
