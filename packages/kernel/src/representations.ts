import * as ableton from "@ableton-extensions/sdk";
import {
  buildRepresentations,
  coerceNumber,
  type DrumPadEntry,
  type IrNote,
  type MusicalContext,
  type RepresentationId,
  REPRESENTATION_IDS,
  type StructureTrack,
} from "@quantumaudio/music-ir";
import type { SerializedClip, SerializedSongOverview, SerializedTrackFull } from "@quantumaudio/ableton-mcp-schemas";
import type { Ctx } from "./protocol.js";

// Live e2e for representations param: TODOLLIST.md § Intermediate representations
export function parseRepresentationIds(raw: unknown): RepresentationId[] {
  if (!Array.isArray(raw)) return [];
  const ids: RepresentationId[] = [];
  for (const item of raw) {
    if (typeof item === "string" && (REPRESENTATION_IDS as readonly string[]).includes(item)) {
      ids.push(item as RepresentationId);
    }
  }
  return ids;
}

function timeSignatureFromSong(song: ableton.Song<"1.0.0">): MusicalContext["timeSignature"] {
  const scene = song.scenes[0];
  if (scene) {
    return {
      numerator: coerceNumber(scene.signatureNumerator),
      denominator: coerceNumber(scene.signatureDenominator),
    };
  }
  return { numerator: 4, denominator: 4 };
}

export function musicalContextFromSong(
  song: ableton.Song<"1.0.0">,
  extras: Partial<Pick<MusicalContext, "clipLengthBeats" | "clipName" | "drumPadMap">> = {},
): MusicalContext {
  const scale: MusicalContext["scale"] = {
    rootNote: coerceNumber(song.rootNote),
    scaleName: song.scaleName,
    scaleMode: song.scaleMode,
    scaleIntervals: song.scaleIntervals.map(coerceNumber),
  };
  return {
    tempo: coerceNumber(song.tempo),
    timeSignature: timeSignatureFromSong(song),
    scale,
    ...extras,
    clipLengthBeats: extras.clipLengthBeats !== undefined ? coerceNumber(extras.clipLengthBeats) : undefined,
    drumPadMap: extras.drumPadMap?.map((p) => ({
      receivingNote: coerceNumber(p.receivingNote),
      label: p.label,
    })),
  };
}

function drumPadMapFromRack(rack: ableton.DrumRack<"1.0.0">): DrumPadEntry[] {
  return rack.chains
    .filter((c): c is ableton.DrumChain<"1.0.0"> => c instanceof ableton.DrumChain)
    .map((chain) => ({
      receivingNote: chain.receivingNote,
      label: chain.devices[0]?.name ?? `pad-${chain.receivingNote}`,
    }));
}

/** Find the first Drum Rack on a track for pad labels in drumGrid IR. */
export function findDrumPadMap(track: ableton.Track<"1.0.0">): DrumPadEntry[] | undefined {
  for (const d of track.devices) {
    if (d instanceof ableton.DrumRack) return drumPadMapFromRack(d);
  }
  return undefined;
}

export function attachClipRepresentations(
  result: SerializedClip & { representations?: Record<string, string> },
  notes: IrNote[],
  ctx: MusicalContext,
  ids: RepresentationId[],
): void {
  if (ids.length === 0) return;
  const clipIds = ids.filter((id) => id !== "structure");
  if (clipIds.length === 0) return;
  result.representations = buildRepresentations(clipIds, notes, {
    ...ctx,
    clipLengthBeats: result.duration,
    clipName: result.name,
  });
}

function clipToStructure(c: SerializedClip, startBeat: number): StructureTrack["arrangementClips"][number] {
  return {
    name: c.name,
    type: c.type,
    startBeat,
    endBeat: startBeat + c.duration,
    noteCount: c.noteCount,
  };
}

export function structureTracksFromOverview(overview: SerializedSongOverview): StructureTrack[] {
  return overview.tracks.map((t) => ({
    index: t.index,
    name: t.name,
    type: t.type,
    sessionClips: t.clipSlots
      .filter((s) => s.clip)
      .map((s) => clipToStructure(s.clip!, s.slot * 4)),
    arrangementClips: [],
  }));
}

export function structureTracksFromTrackFull(track: SerializedTrackFull): StructureTrack[] {
  return [
    {
      index: track.index,
      name: track.name,
      type: track.type,
      sessionClips: track.sessionClips
        .filter((s) => s.clip)
        .map((s) => clipToStructure(s.clip!, s.slot * 4)),
      arrangementClips: track.arrangementClips
        .filter((a) => a.clip)
        .map((a) => {
          const c = a.clip!;
          return clipToStructure(c, c.startTime);
        }),
    },
  ];
}

export function attachStructureRepresentations(
  result: { representations?: Record<string, string> },
  tracks: StructureTrack[],
  ctx: MusicalContext,
  ids: RepresentationId[],
): void {
  if (!ids.includes("structure")) return;
  const built = buildRepresentations(["structure"], [], ctx, tracks);
  if (built.structure) {
    result.representations = { ...result.representations, structure: built.structure };
  }
}

export function songContext(ctx: Ctx): MusicalContext {
  return musicalContextFromSong(ctx.application.song);
}
