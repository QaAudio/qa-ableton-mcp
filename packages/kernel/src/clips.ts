import * as ableton from "@ableton-extensions/sdk";
import type { Ctx, HandlerResult } from "./protocol.js";
import { type Address, findTrackIndex } from "./address.js";
import type { RepresentationId } from "@quantumaudio/music-ir";
import { serializeClipFull, serializeClipSummary } from "./serialize/index.js";
import { attachClipRepresentations, findDrumPadMap, musicalContextFromSong } from "./representations.js";
import { kernelLog, formatAddr } from "./log.js";

type MidiClipAddr = Extract<Address, { kind: "clipSlot" } | { kind: "arrangementClip" }>;
type ClipView = "session" | "arrangement";

export function sameHandle(a: ableton.DataModelObject<"1.0.0">, b: ableton.DataModelObject<"1.0.0">): boolean {
  return a.handle.id === b.handle.id;
}

export function midiTrackAt(ctx: Ctx, trackIndex: number): ableton.MidiTrack<"1.0.0"> {
  const track = ctx.application.song.tracks[trackIndex];
  if (!track) throw new Error(`No track at index ${trackIndex}`);
  if (!(track instanceof ableton.MidiTrack)) {
    throw new Error(`Track ${trackIndex} ("${track.name}") is not a MIDI track — use a MIDI track index from get_context`);
  }
  return track;
}

export async function resolveMidiClip(
  ctx: Ctx,
  addr: Address,
): Promise<{ clip: ableton.MidiClip<"1.0.0">; addr: MidiClipAddr; view: ClipView }> {
  if (addr.kind === "clipSlot") {
    const slot = ctx.application.song.tracks[addr.track]?.clipSlots[addr.slot];
    if (!slot) throw new Error(`No clip slot at track ${addr.track} slot ${addr.slot}`);
    const clip = slot.clip;
    if (!clip) throw new Error(`No clip in slot track ${addr.track} slot ${addr.slot} — create a clip via run_code first`);
    if (!(clip instanceof ableton.MidiClip)) throw new Error(`Clip in slot track ${addr.track} slot ${addr.slot} is not MIDI`);
    return { clip, addr, view: "session" };
  }
  if (addr.kind === "arrangementClip") {
    const clip = ctx.application.song.tracks[addr.track]?.arrangementClips[addr.index];
    if (!clip) throw new Error(`No arrangement clip at track ${addr.track} index ${addr.index}`);
    if (!(clip instanceof ableton.MidiClip)) throw new Error(`Arrangement clip track ${addr.track} index ${addr.index} is not MIDI`);
    return { clip, addr, view: "arrangement" };
  }
  throw new Error("addr must be a clipSlot or arrangementClip address");
}

export function arrangementClipAddr(
  ctx: Ctx,
  track: ableton.Track<"1.0.0">,
  clip: ableton.MidiClip<"1.0.0">,
): Extract<Address, { kind: "arrangementClip" }> {
  const trackIndex = findTrackIndex(ctx, track);
  if (trackIndex === null) throw new Error("Could not resolve track index for arrangement clip");
  for (let i = 0; i < track.arrangementClips.length; i++) {
    const c = track.arrangementClips[i]!;
    if (sameHandle(c, clip)) return { kind: "arrangementClip", track: trackIndex, index: i };
  }
  throw new Error("Arrangement clip not found — re-query get_context");
}

type ClipMatch = { clip: ableton.MidiClip<"1.0.0">; addr: MidiClipAddr; view: ClipView };

function collectSessionMatches(track: ableton.MidiTrack<"1.0.0">, trackIndex: number, name: string): ClipMatch[] {
  const out: ClipMatch[] = [];
  for (let slot = 0; slot < track.clipSlots.length; slot++) {
    const clip = track.clipSlots[slot]?.clip;
    if (clip instanceof ableton.MidiClip && clip.name === name) {
      out.push({ clip, addr: { kind: "clipSlot", track: trackIndex, slot }, view: "session" });
    }
  }
  return out;
}

function collectArrangementMatches(track: ableton.MidiTrack<"1.0.0">, trackIndex: number, name: string): ClipMatch[] {
  const out: ClipMatch[] = [];
  for (let index = 0; index < track.arrangementClips.length; index++) {
    const clip = track.arrangementClips[index];
    if (clip instanceof ableton.MidiClip && clip.name === name) {
      out.push({ clip, addr: { kind: "arrangementClip", track: trackIndex, index }, view: "arrangement" });
    }
  }
  return out;
}

export function findAllClipsByName(
  ctx: Ctx,
  trackIndex: number,
  name: string,
  view: "session" | "arrangement" | "both" = "both",
): ClipMatch[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("clip name must be a non-empty string");
  const track = midiTrackAt(ctx, trackIndex);
  const matches: ClipMatch[] = [];
  if (view === "session" || view === "both") matches.push(...collectSessionMatches(track, trackIndex, trimmed));
  if (view === "arrangement" || view === "both") matches.push(...collectArrangementMatches(track, trackIndex, trimmed));
  if (matches.length === 0) {
    throw new Error(`No MIDI clip named "${trimmed}" on track ${trackIndex} ("${track.name}") in ${view} view`);
  }
  return matches;
}

export function findClipByName(
  ctx: Ctx,
  trackIndex: number,
  name: string,
  view: "session" | "arrangement" | "both" = "both",
): ClipMatch {
  const trimmed = name.trim();
  const matches = findAllClipsByName(ctx, trackIndex, trimmed, view);

  if (matches.length > 1) {
    const locations = matches
      .map((m) =>
        m.view === "session"
          ? `session slot ${(m.addr as { slot: number }).slot}`
          : `arrangement index ${(m.addr as { index: number }).index}`,
      )
      .join(", ");
    throw new Error(
      `Multiple MIDI clips named "${trimmed}" on track ${trackIndex} — found at ${locations}. Use a unique name or pass view:'session'/'arrangement' with addr.`,
    );
  }
  return matches[0]!;
}

export type PitchMapEntry = { from: number; to: number };

export function parsePitchMap(raw: unknown): Map<number, number> {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("pitchMap must be a non-empty array of {from, to} entries");
  const map = new Map<number, number>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) throw new Error(`pitchMap[${i}] must be an object`);
    const row = item as Record<string, unknown>;
    const from = row.from;
    const to = row.to;
    if (typeof from !== "number" || !Number.isInteger(from) || from < 0 || from > 127) {
      throw new Error(`pitchMap[${i}].from must be an integer 0–127`);
    }
    if (typeof to !== "number" || !Number.isInteger(to) || to < 0 || to > 127) {
      throw new Error(`pitchMap[${i}].to must be an integer 0–127`);
    }
    if (map.has(from)) throw new Error(`pitchMap has duplicate from pitch ${from}`);
    map.set(from, to);
  }
  return map;
}

export function remapNotes<T extends { pitch: number }>(notes: T[], map: Map<number, number>): { notes: T[]; remapped: number } {
  let remapped = 0;
  const out = notes.map((n) => {
    const to = map.get(n.pitch);
    if (to === undefined) return n;
    remapped++;
    return { ...n, pitch: to };
  });
  return { notes: out, remapped };
}

export function uniquePitches(notes: { pitch: number }[]): number[] {
  return [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
}

export function buildPitchSummary(notes: { pitch: number }[]): { pitches: number[]; counts: Record<string, number> } {
  const counts = new Map<number, number>();
  for (const n of notes) counts.set(n.pitch, (counts.get(n.pitch) ?? 0) + 1);
  const pitches = [...counts.keys()].sort((a, b) => a - b);
  const countsObj: Record<string, number> = {};
  for (const [pitch, count] of counts) countsObj[String(pitch)] = count;
  return { pitches, counts: countsObj };
}

export type FindClipParams = {
  track: number;
  name: string;
  view?: "session" | "arrangement" | "both";
  includePitchSummary?: boolean;
  representations?: RepresentationId[];
};

export async function findClip(ctx: Ctx, params: FindClipParams): Promise<HandlerResult> {
  const view = params.view ?? "both";
  const trackIndex = Number(params.track);
  const { clip, addr, view: clipView } = findClipByName(ctx, trackIndex, String(params.name), view);
  const clipData = serializeClipFull(clip, "detailed");
  const result: Record<string, unknown> = {
    addr,
    view: clipView,
    clip: clipData,
    noteCount: clip.notes.length,
  };
  if (params.includePitchSummary) result.pitchSummary = buildPitchSummary(clip.notes);
  if (params.representations?.length) {
    const track = ctx.application.song.tracks[trackIndex];
    const mctx = musicalContextFromSong(ctx.application.song, {
      clipLengthBeats: clip.duration,
      clipName: clip.name,
      drumPadMap: track ? findDrumPadMap(track) : undefined,
    });
    attachClipRepresentations(clipData, clip.notes, mctx, params.representations);
    if (clipData.representations) result.representations = clipData.representations;
  }
  kernelLog.debug("find_clip", `found "${clip.name}" at ${formatAddr(addr)} (${clipView}) notes=${clip.notes.length}`);
  return { result };
}

export type RemapClipNotesParams = {
  scope: "clip" | "trackArrangement";
  addr?: MidiClipAddr;
  track?: number;
  clipName?: string;
  pitchMap: unknown;
};

async function collectMidiClipsForRemap(ctx: Ctx, params: RemapClipNotesParams): Promise<ClipMatch[]> {
  const scope = params.scope;
  if (scope === "clip") {
    if (params.addr) {
      const resolved = await resolveMidiClip(ctx, params.addr);
      return [resolved];
    }
    const trackIndex = params.track;
    const clipName = params.clipName;
    if (trackIndex === undefined || clipName === undefined) {
      throw new Error("scope 'clip' requires addr or (track + clipName)");
    }
    return [findClipByName(ctx, Number(trackIndex), String(clipName), "both")];
  }

  const trackIndex = params.track;
  if (trackIndex === undefined || !Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("scope 'trackArrangement' requires track (MIDI track index)");
  }
  const track = midiTrackAt(ctx, trackIndex);
  const out: ClipMatch[] = [];
  for (let index = 0; index < track.arrangementClips.length; index++) {
    const clip = track.arrangementClips[index];
    if (clip instanceof ableton.MidiClip) {
      out.push({ clip, addr: { kind: "arrangementClip", track: trackIndex, index }, view: "arrangement" });
    }
  }
  if (out.length === 0) {
    throw new Error(`No arrangement MIDI clips on track ${trackIndex} ("${track.name}")`);
  }
  return out;
}

export async function remapClipNotes(ctx: Ctx, params: RemapClipNotesParams): Promise<HandlerResult> {
  const pitchMap = parsePitchMap(params.pitchMap);
  const targets = await collectMidiClipsForRemap(ctx, params);

  const result = await ctx.withinTransaction(async () => {
    const clipsOut: Record<string, unknown>[] = [];
    let totalNotesRemapped = 0;
    const unmappedUsed = new Set<number>();

    for (const { clip, addr } of targets) {
      const { notes, remapped } = remapNotes(clip.notes, pitchMap);
      for (const n of clip.notes) {
        if (!pitchMap.has(n.pitch)) unmappedUsed.add(n.pitch);
      }
      clip.notes = notes;
      totalNotesRemapped += remapped;
      clipsOut.push({
        addr,
        name: clip.name,
        notesRemapped: remapped,
        pitchSummary: buildPitchSummary(clip.notes),
      });
    }

    return {
      scope: params.scope,
      clips: clipsOut,
      totalNotesRemapped,
      unmappedPitchesUsed: [...unmappedUsed].sort((a, b) => a - b),
    };
  });

  const out = result as { totalNotesRemapped: number; clips: unknown[] };
  kernelLog.info(
    "remap_clip_notes",
    `scope=${params.scope} clips=${out.clips.length} notesRemapped=${out.totalNotesRemapped}`,
  );
  return { result };
}
