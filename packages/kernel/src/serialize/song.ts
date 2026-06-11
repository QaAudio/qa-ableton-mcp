import * as ableton from "@ableton-extensions/sdk";
import type {
  SerializedSongOverview,
  SerializedSongScale,
} from "@quantumaudio/ableton-mcp-schemas";
import type { Ctx } from "../protocol.js";
import { buildPerceiveHints } from "../clip-placement.js";
import { serializeAuxTrack, serializeTrackOverview } from "./track.js";
import { isDetailed, type OverviewOptions } from "./common.js";

function gridQuantizationName(q: number): string {
  const name = (ableton.GridQuantization as unknown as Record<number, string>)[q];
  return name ?? String(q);
}

export async function serializeSongOverview(
  ctx: Ctx,
  opts: OverviewOptions,
): Promise<SerializedSongOverview> {
  const song = ctx.application.song;
  const format = opts.responseFormat;

  const tracks = await Promise.all(
    song.tracks.map((t, i) => serializeTrackOverview(ctx, t, i, opts)),
  );

  const scenes = song.scenes.map((s, i) => ({
    addr: { kind: "scene" as const, index: i },
    index: i,
    name: s.name,
    tempo: s.tempo,
    signature: `${s.signatureNumerator}/${s.signatureDenominator}`,
  }));

  const cuePoints = song.cuePoints.map((c, i) => ({
    addr: { kind: "cuePoint" as const, index: i },
    index: i,
    name: c.name,
    time: c.time,
  }));

  const scale: SerializedSongScale = {
    rootNote: song.rootNote,
    scaleName: song.scaleName,
    scaleMode: song.scaleMode,
  };
  if (isDetailed(format)) scale.scaleIntervals = song.scaleIntervals;

  const result: SerializedSongOverview = {
    tempo: song.tempo,
    scale,
    grid: { quantization: gridQuantizationName(song.gridQuantization), isTriplet: song.gridIsTriplet },
    trackCount: tracks.length,
    sceneCount: scenes.length,
    tracks,
    scenes,
    cuePoints,
  };

  if (opts.includeReturns !== false) {
    result.returnTracks = await Promise.all(
      song.returnTracks.map((t, i) => serializeAuxTrack(t, { kind: "returnTrack", index: i })),
    );
  }
  if (opts.includeMain !== false) {
    result.mainTrack = await serializeAuxTrack(song.mainTrack, { kind: "mainTrack" });
  }

  const perceiveHints = buildPerceiveHints(tracks);
  if (perceiveHints.length > 0) result.perceiveHints = perceiveHints;

  return result;
}
